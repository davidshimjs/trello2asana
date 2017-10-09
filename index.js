var fs = require('fs-extra');
var util = require('util');
var Promise = require("bluebird");
var _ = require('underscore');
var package = fs.readJsonSync('package.json');
var Asana = require('asana');
var Trello = require("node-trello");
var request = require('request');
var path = require('path');

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

var convertMap = function convertToMap(data, map) {
    if (_.isArray(data)) {
        return _.compact(_.map(data, id => {
            return convertToMap(id, map);
        }));
    }

    if (typeof map[data] !== 'undefined') {
        return map[data];
    } else {
        return null;
    }
};

var fetchImage = function (url) {
    return new Promise(function (resolve, reject) {
        request.get({
            url: url,
            encoding: null
        }, function (err, res, body) {
            if (err || res.statusCode !== 200) {
                reject(err || res.statusCode);
                return;
            }

            if (body) {
                resolve(body);
            } else {
                resolve(null);
            }
        });
    });
};

fs.readJson(opts.config).then(function (config) {
    var client = Asana.Client.create().useAccessToken(config.asana.personal_access_token);
    var trello = new Trello(config.trello.key, config.trello.token);
    var asanaData = {
        projects: [],
        tags: [],
        users: []
    };

    var uploadImageToAsana = function (taskId, file, filename) {
        return new Promise(function (resolve, reject) {
            request.post({
                url: `https://app.asana.com/api/1.0/tasks/${taskId}/attachments`,
                headers: {
                    Authorization: `Bearer ${config.asana.personal_access_token}`
                },
                formData: {
                    file: {
                        value: file,
                        options: {
                            filename: filename
                        }
                    }
                }
            }, function (err, res, body) {
                if (err || res.statusCode !== 200) {
                    reject(err || res.statusCode);
                    return;
                }

                if (body) {
                    try {
                        body = JSON.parse(body);
                    } catch (e) {}
                }

                resolve(body);
            });
        });
    };

    Promise.promisifyAll(trello);

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

    // Prepare asana data to avoid duplicated
    return Promise.join(
        client.projects.findByTeam(config.asana.team).then(fetch),
        client.tags.findByWorkspace(config.asana.workspace).then(fetch),
        client.users.findByWorkspace(config.asana.workspace).then(fetch),
        (projects, tags, users) => {
            asanaData.projects = projects;
            asanaData.tags = tags;
            asanaData.users = users;
        }
    ).then(function () {
        return Promise.map(opts.files, parseJson);
    }).then(function (files) {
        var trellMembers = _.flatten(_.pluck(files, 'members'));

        // Check only member list
        if (opts.onlyMembers) {
            console.log('Trello Users');
            console.log('<id>: <FullName>(<username>)');
            console.log(_.map(trellMembers, function (member) {
                return `${member.id}: ${member.fullName}(${member.username})`;
            }).join('\n'));

            console.log('\nAsana Users');
            console.log('<id>: <Name>');

            _.each(asanaData.users, user => {
                console.log(`${user.id}: ${user.name}`);
            });

            throw Promise.CancellationError;
        }

        // Executes in order
        return Promise.mapSeries(files, function (file) {
            let projectData;
            let listToSectionMap = {};
            let cardToTaskMap = {};
            let labelToTagMap = {};
            let checklistMap = {};
            let userMap = {};

            _.each(file.checklists, checklist => {
                checklistMap[checklist.id] = checklist;
            });

            _.each(asanaData.users, user => {
                userMap[user.id] = user.name;
            });

            // Creates a Project
            return client.projects.createInTeam(config.asana.team, {
                name: getUniqueName(file.name, _.pluck(asanaData.projects, 'name')),
                notes: file.desc,
                layout: 'board'
            }).then(result => {
                console.log(`Created ${result.name} project in your team.`);
                projectData = result;
                asanaData.projects.push(result);

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
                // Filter exists tags same with label
                var labels = _.filter(file.labels, label => {
                    var matchedTag = _.find(asanaData.tags, tag => {
                        return tag.name === label.name;
                    });

                    if (matchedTag) {
                        labelToTagMap[label.id] = matchedTag.id;
                        return false;
                    } else {
                        return true;
                    }
                });

                // Creates tags
                console.log(`Creating ${labels.length} tags...`);

                return Promise.map(labels, label => {
                    return client.tags.createInWorkspace(config.asana.workspace, {
                        name: label.name,
                        color: LABEL_COLOR[label.color],
                        notes: 'Created by Trello'
                    }).then(result => {
                        labelToTagMap[label.id] = result.id;
                        asanaData.tags.push(result);
                        console.log(`Created ${result.name}(${result.id}) tag.`);
                    });
                }, {
                    concurrency: 3
                }).then(function () {
                    console.log(`Creating ${file.cards.length} tasks...`);
                    let countTask = 0;

                    // Creates tasks
                    return Promise.mapSeries(file.cards, card => {
                        return client.tasks.create({
                            assignee: card.idMembers.length ? convertMap(_.first(card.idMembers), config.member) : null,
                            due_at: card.due,
                            followers: card.idMembers.length > 1 ? convertMap(card.idMembers, config.member) : [],
                            name: card.name,
                            notes: card.desc,
                            memberships: [{
                                project: projectData.id,
                                section: convertMap(card.idList, listToSectionMap)
                            }],
                            tags: card.idLabels.length ? convertMap(card.idLabels, labelToTagMap) : [],
                            projects: [ projectData.id ]
                        }).then(result => {
                            var promises = [];
                            var taskData = result;
                            cardToTaskMap[card.id] = result.id;
                            countTask++;

                            if (countTask % 10 === 0) {
                                console.log(`${countTask}...`);
                            }

                            if (card.idChecklists.length) {
                                promises.push(
                                    Promise.mapSeries(convertMap(card.idChecklists.reverse(), checklistMap), checklist => {
                                        return Promise.mapSeries(checklist.checkItems.reverse(), item => {
                                            return client.tasks.addSubtask(taskData.id, {
                                                name: item.name,
                                                completed: item.state !== 'incomplete'
                                            });
                                        }).then(function () {
                                            return client.tasks.addSubtask(taskData.id, {
                                                name: `${checklist.name}:`
                                            });
                                        });
                                    })
                                );
                            }

                            if (parseInt(card.badges.comments, 10) > 0) {
                                promises.push(
                                    // Trello export has limitation for count of actions as 1000. so we need to request directly trello API.
                                    trello.getAsync(`/1/cards/${card.id}/actions?limit=1000`).then(result => {
                                        var comments = _.filter(result, action => {
                                            return action.type === 'commentCard';
                                        });

                                        return Promise.mapSeries(comments.reverse(), comment => {
                                            var member = convertMap(comment.idMemberCreator, config.member);
                                            var text = comment.data.text;
                                            var memberName = member ? convertMap(member, userMap) : comment.memberCreator.fullName;

                                            text = `${memberName}: ${text} from Trello`;

                                            return client.tasks.addComment(taskData.id, {
                                                text: text
                                            });
                                        });
                                    })
                                );
                            }

                            if (card.attachments.length) {
                                promises.push(
                                    Promise.mapSeries(card.attachments, attachment => {
                                        return fetchImage(attachment.url).then(image => {
                                            return uploadImageToAsana(taskData.id, image, path.basename(attachment.url));
                                        });
                                    })
                                );
                            }

                            return Promise.all(promises);
                        });
                    });
                });
            }).then(function () {
                console.log('complete!');
            });
        });
    });
}).catch(reason => {
    console.error(reason);
}).catch(Promise.CancellationError, function (reason) {
    // nothing to do
});
