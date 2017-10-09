This module supports conversion of the following.

- Lists(to Sections with board view, exclude archived)
- Cards(to Tasks, exclude archived)
- Checklists(to SubTasks)
- Comments(noted author name. asana doesn't support switch author.)
- Assignee, Followers
- Labels(to Tags, with colors)
- Attachments

# How to Use

1. Exports Your Trello Board Backup file as JSON

2. Creates Trello Token
- https://trello.com/app-key

3. Creates Personal Token in Asana Connect
- https://asana.com/guide/help/api/api#gl-connect

4. Makes Configuration for matching members, select asana team, workspace and so on. You can easily use `-m` option for finding members. You should rename `config.json.sample` file to `config.json`.

If you have done all of the above, try the following command.

```
$ git clone https://github.com/davidshimjs/trello2asana.git
$ cd trello2asana
$ yarn # or npm install
$ node index.js <JSON_PATH_EXPORTED_FROM_TRELLO_BOARD>
```

and you can check out more information below.

```
Usage: /usr/local/bin/node index.js <files>... [options]

files     Path JSON file exported from Trello

Options:
   -c PATH, --config PATH   Specify Config File  [config.json]
   -m, --only-members       See Members of Trello without execute scripts.
   -a, --append             Append tasks when exists the same project
```

# Examples

<img src="https://user-images.githubusercontent.com/3103540/31360077-b38b7208-ad87-11e7-8298-84037a932240.png">

<img src="https://user-images.githubusercontent.com/3103540/31360174-3010b798-ad88-11e7-928d-945ff080e732.png">
