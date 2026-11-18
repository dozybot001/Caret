# Data inventory

English | [简体中文](../zh/data-inventory.md)

- Caret has no accounts and no application server
- Your requests, global instructions and the file contents the Agent reads go only to the model service you configured
- Common secret files, such as `.env`, private keys and login files for cloud and package tools, are not read
- API keys, settings and conversations are stored only in this device's browser, and you can delete all of them on the Data page in Settings
- When you use the hosted page, the server records access logs with the time, IP address and page visited, without URL parameters, and deletes them after 6 months

| Data | Source | Purpose | Where and how long | How to delete |
| --- | --- | --- | --- | --- |
| Model service settings and API key | You enter them in Settings | Calling the model service you chose | This device's IndexedDB, until you delete it | Data page in Settings |
| Preferences and global instructions | You enter them in Settings | Running with your preferences | This device's IndexedDB, until you delete it | Reset settings, or the Data page |
| Conversations, including file contents the Agent read | Your conversations with the Agent | Resuming and continuing conversations | This device's IndexedDB, up to 100 per project | Delete in History, or the Data page; saving can be turned off |
| Prompts you sent | The input bar | Recalling them with the arrow keys | This device's IndexedDB, up to 200 per project | Data page |
| Folder access and open tabs | The folder you chose | Restoring them next time | This device's IndexedDB, until you delete it | Revoke folder access, or the Data page |
| Theme, language and panel widths | Settings and the interface | Showing your preferences as the page opens | This device's localStorage, until you delete it | Data page |
| Requests, global instructions, and file contents and paths the Agent reads | Your conversations | Doing the task | The model service you chose, under its privacy policy | Under that provider's rules |
| Access logs: time, IP address, page visited (without parameters), status and duration | Visiting the hosted page | Network security | The server, deleted automatically after 6 months | Deleted automatically |

The privacy policy and terms of service are under About in Settings.
