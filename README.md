This module supports conversion of the following.

- Lists(to Sections with board view, exclude archived)
- Cards(to Tasks, exclude archived)
- Checklists(to SubTasks)
- Comments(noted author name. asana doesn't support switch author.)
- Assignee, Followers
- Attachments

# How to Use

1. Exports Your Trello Board Backup file as JSON

2. Creates Trello Token
- https://trello.com/app-key

3. Creates Personal Token in Asana Connect
- https://asana.com/guide/help/api/api#gl-connect

4. Makes Configuration for matching members, select asana team, workspace and so on. You can easily use `-m` option for finding members. You should rename `config.json.sample` file to `config.json`.
