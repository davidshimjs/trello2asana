var fs = require('fs-extra');
var util = require('util');
var Promise = require("bluebird");
var _ = require('underscore');
var package = fs.readJsonSync('package.json');
var Asana = require('asana');

var LABEL_COLOR = {
    green: 'light-green',
    yellow: 'light-yellow',
    orange: 'dark-orange',
    red: 'light-red',
    purple: 'dark-purple',
    blue: 'dark-blue',
    sky: 'light-blue',
    lime: 'light-orange',
    pink: 'light-pink',
    black: 'dark-warm-gray'
};

var opts = require('nomnom')
        .help('Import Asana Project from Trello Board with exported JSON file')
        .options({
            files: {
                help: 'Path JSON file exported from Trello',
                position: 0,
                list: true,
                required: true
            },
            config: {
                help: 'Specify Config File',
                string: '-c PATH, --config PATH',
                'default': 'config.json'
            },
            onlyMembers: {
                help: 'See Members of Trello without execute scripts.',
                abbr: 'm',
                full: 'only-members',
                flag: true
            }
        })
        .parse();

var parseJson = function (path) {
    return fs.readJson(path).then(function (data) {
        var output = _.pick(data, [
            'name', 'desc', 'labels', 'cards', 'lists', 'members', 'checklists'
        ]);

        output.cards = _.filter(output.cards, function (card) {
            return !card.closed;
        });

        output.lists = _.filter(output.lists, function (list) {
            return !list.closed;
        });

        return output;
    });
};

var fetch = function (result) {
    return result.fetch();
};

var getUniqueName = function getUniqueName(name, haystack) {
    const rxPostfix = / \(([0-9]+)\)$/;

    if (_.contains(haystack, name)) {
        const mat = rxPostfix.exec(name);
        let pureName = name.replace(rxPostfix, '');
        const number = mat ? parseInt(mat[1], 10) + 1 : 1;

        return getUniqueName(pureName + ` (${number})`, haystack);
    } else {
        return name;
    }
};

fs.readJson(opts.config).then(function (config) {
    var client = Asana.Client.create().useAccessToken(config.asana.personal_access_token);
    var projects = [];

    if (!config.asana.workspace) {
        console.log('You should select your workspace in asana.');
        console.log('<id>: <name>');

        return client.workspaces.findAll().then(fetch).then(workspaces => {
            _.each(workspaces, workspace => {
                console.log(`${workspace.id}: ${workspace.name}`);
            });

            throw Promise.CancellationError;
        });
    }

    if (!config.asana.team) {
        return client.teams.findByOrganization(config.asana.workspace).then(fetch).then(teams => {
            console.log('You should select a team in asana.');
            console.log('<id>: <name>');

            _.each(teams, team => {
                console.log(`${team.id}: ${team.name}`);
            });

            throw Promise.CancellationError;
        });
    }

    return client.projects.findByTeam(config.asana.team).then(fetch).then(results => {
        projects = results;

        return Promise.map(opts.files, parseJson);
    }).then(function (files) {
        // Check only member list
        if (opts.onlyMembers) {
            var members = _.flatten(_.pluck(files, 'members'));

            console.log('Trello Users');
            console.log('<username>: <FullName>');
            console.log(_.map(members, function (member) {
                return `${member.username}: ${member.fullName}`;
            }).join('\n'));

            console.log('\nAsana Users');
            console.log('<id>: <Name>');

            return client.users.findByWorkspace(config.asana.workspace).then(fetch).then(users => {
                _.each(users, user => {
                    console.log(`${user.id}: ${user.name}`);
                });

                throw Promise.CancellationError;
            });
        }

        // Executes in order
        return Promise.mapSeries(files, function (file) {
            let projectData;
            let listToSectionMap = {};
            let cardToTaskMap = {};
            let labelToTagMap = {};

            // Creates a Project
            return client.projects.createInTeam(config.asana.team, {
                name: getUniqueName(file.name, _.pluck(projects, 'name')),
                notes: file.desc,
                layout: 'board'
            }).then(result => {
                console.log(`Created ${result.name} project in your team.`);
                projectData = result;

                // Creates sections in order
                return Promise.mapSeries(file.lists, list => {
                    return client.sections.createInProject(projectData.id, {
                        name: list.name
                    }).then(result => {
                        listToSectionMap[list.id] = result.id;
                        console.log(`Created ${list.name} section.`);
                    });
                });
            }).then(() => {
                // Creates tags
                return Promise.map(file.labels, label => {
                    return client.tags.create({

                    }).then(result => {

                    });
                });

                console.log(`Creating ${file.cards.length} parent tasks...`);

                // Creates tasks
                return Promise.map(file.cards, card => {

                }, { concurrency: 3 });
            });
        });
    });
}).catch(Promise.CancellationError, function (reason) {
    // nothing to do
}).catch(function (reason) {
    console.error(reason);
});
