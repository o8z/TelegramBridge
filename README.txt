Telegram <==> Revolt brige.

Configuration file is "config.json".

You must specify "revolt_bot_token" and "telegram_bot_token".
"bridges" is an array of bridge objects.
Bridge object:
{
  "telegram_chat_id": "-xxxx",
  "revolt_channel_id": "xxxx"
}

Example configuration:
{
  "revolt_bot_token": "<TOKEN>",
  "telegram_bot_token": "<TOKEN>",
  "bridges": [
    {
      "telegram_chat_id": "<CHAT_ID>",
      "revolt_channel_id": "<CHANNEL_ID>"
    }
  ]
}

Any questions? Contact me! :)
- Telegram: @pmdev.
