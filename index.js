const { Telegraf } = require("telegraf");
const Extra = require("telegraf/extra");
const { Client } = require("revolt.js");
const fetch = require("node-fetch");
const fs = require("fs");
const FormData = require("form-data");
const mimetypes = require("mime-types");

const ENDPOINTS = {
  telegram_api: "https://api.telegram.org",
  revolt_api: "https://api.revolt.chat",
  revolt_autumn: "https://autumn.revolt.chat"
};

async function check_telegram_token(token){
  let response = await fetch(ENDPOINTS.telegram_api + "/bot" + token + "/getMe");
  return response.status == 200;
}

async function check_revolt_token(token){
  let response = await fetch(ENDPOINTS.revolt_api + "/users/@me", {
    method: "GET",
    headers: {
      "X-Bot-Token": token
    }
  });
  return response.status == 200;
}

async function getUser(token, id){
  let response = await fetch(ENDPOINTS.revolt_api + "/users/" + id, {
    method: "GET",
    headers: {
      "X-Bot-Token": token
    }
  });
  return (response.status == 200 ? (await response.json()) : {});
}

async function getChannel(token, id){
  let response = await fetch(ENDPOINTS.revolt_api + "/channels/" + id, {
    method: "GET",
    headers: {
      "X-Bot-Token": token
    }
  });
  return (response.status == 200 ? (await response.json()) : {});
}

function getMediaType(mime){
	if(mime.startsWith("image/"))return "photo";
	if(mime.startsWith("video/"))return "video";
	return "document";
}

function escapeString(content){
	content = content.replace(/_/giu, "\\_")
					 .replace(/-/giu, "\\-")
					 .replace(/~/giu, "\\~")
					 .replace(/`/giu, "\\`")
					 .replace(/\./giu, "\\.")
					 .replace(/\*/, "\\*");
	return content;
}

async function contentFixer(token, content, attachment = true){
	if(content == "" || content == null)return content;
	let matches = content.match(/<@([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})>/giu) || [];
	for(const match of matches){
		let user = await getUser(token, match.match(/([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})/giu)[0]);
		if(user.username)content = content.replace(match, "@<" + user.username + ">");
	}
	matches = content.match(/<#([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})>/giu) || [];
	for(const match of matches){
		let channel = await getChannel(token, match.match(/([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})/giu)[0]);
		if(attachment && channel.name)content = content.replace(match, "#" + channel.name);
		if(!attachment && channel.name)content = content.replace(match, "\\#" + channel.name);
	}
	return content;
}

async function upload(token, telegram, attachment){
  let url = await telegram.getFileLink(attachment.file_id);
  let form = new FormData();
  
  let response = await fetch(url);
  
  let filename = url.split("/").pop() || "file";
  let mime = mimetypes.lookup(filename) || "application/octet-stream";
  
  let data = Buffer.from(await response.arrayBuffer());
  form.append("file", data, {
    contentType: mime,
    name: "file",
    filename: filename
  });
  
  response = await fetch(ENDPOINTS.revolt_autumn + "/attachments", {
    method: "POST",
    headers: {
      "X-Bot-Token": token
    },
    body: form
  });
  
  return (await response.json()).id;
}

async function sendMessage(token, channel_id, content, attachments){
  let payload = {
    content,
    nonce: require("ulid").ulid()
  };
  if(attachments.length)payload.attachments = attachments;
  let response = await fetch(ENDPOINTS.revolt_api + "/channels/" + channel_id + "/messages", {
    method: "POST",
    headers: {
      "X-Bot-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function main(){
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
  }catch(e){
    console.log("Invalid or unparsable config.json.");
    console.log(e);
    process.exit(1);
  }
  let { telegram_bot_token, revolt_bot_token } = config;
  if(!(await check_telegram_token(telegram_bot_token))){
    console.log("Telegram bot token is not specified or invalid.");
    process.exit(1);
  }
  if(!(await check_revolt_token(revolt_bot_token))){
    console.log("Revolt token is not specified or invalid.");
    process.exit(1);
  }
  if(!config.bridges || !Array.isArray(config.bridges)){
    console.log("Specify some bridges at first...");
    process.exit(1);
  }
  let revolt = new Client();
  let revolt_me = await getUser(revolt_bot_token, "@me");
  let telegram = new Telegraf(telegram_bot_token);
  revolt.on("ready", () => {
    console.log("[REVOLT] Ready.");
  });
  revolt.on("message", async(message) => {
    if(message.author_id == revolt_me._id)return;
    let bridge = config.bridges.find(element => element.revolt_channel_id == message.channel_id);
    if(!bridge)return;
    if(bridge.telegram_chat_id == null)return;
    let content = message.content;
    message.content = await contentFixer(revolt_bot_token, escapeString(message.content), false);
    if(message.attachments == null)return await telegram.telegram.sendMessage(bridge.telegram_chat_id, message.content, Extra.markdownV2());
    let attachments = (message.attachments || []).map(attachment => [ENDPOINTS.revolt_autumn + "/attachments/" + attachment._id + "/" + attachment.filename, attachment.content_type]);
    attachments = attachments.map(attachment => {
    	return {media: {url: attachment[0]}, type: getMediaType(attachment[1])};
    });
    let attachments_1 = attachments.filter(attachment => attachment.type != "document");
    let attachments_2 = attachments.filter(attachment => attachment.type == "document");
    message.content = await contentFixer(revolt_bot_token, content);
    if(message.content != "" && message.content != null){
    	if(attachments_1.length)attachments_1[0].caption = message.content;
    	else attachments_2[0].caption = message.content;
    }
    if(attachments_1.length)await telegram.telegram.sendMediaGroup(bridge.telegram_chat_id, attachments_1);
    if(attachments_2.length)await telegram.telegram.sendMediaGroup(bridge.telegram_chat_id, attachments_2);
  });
  telegram.on("message", async(ctx) => {
    let message = ctx.update.message;
    let chat_id = message.chat.id.toString();
    let bridge = config.bridges.find(bridge => bridge.telegram_chat_id == chat_id);
    if(!bridge)return;
    if(bridge.revolt_channel_id == null)return;
    let attachment = null;
    if(message.photo)attachment = message.photo;
    if(Array.isArray(attachment))attachment = attachment[attachment.length - 1];
    if(message.video)attachment = message.video;
    if(message.document)attachment = message.document;
    let text = message.caption || message.text || "";
    let attachments = [];
    if(attachment){
      attachments = await upload(revolt_bot_token, telegram.telegram, attachment);
      attachments = [attachments];
    }
    await sendMessage(revolt_bot_token, bridge.revolt_channel_id, text, attachments);
  });
  revolt.loginBot(revolt_bot_token);
  telegram.launch();
}
main();
