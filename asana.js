const fs = require('fs-extra');
const util = require('util');
const Promise = require("bluebird");
const _ = require('underscore');
const Asana = require('asana');
const request = require('request');
const path = require('path');

const opts = require('nomnom')
        .help('Copy Asana tasks in the project to another project')
        .options({
            config: {
                help: 'Specify Config File',
                string: '-c PATH, --config PATH',
                'default': 'config.json'
            },
            from: {
                help: 'Project name'
            },
            to: {
                help: 'Project name'
            },
            section: {
                help: 'Section name'
            }
        })
        .parse();

const fetch = function (result) {
    return _.isFunction(result.fetch) ? result.fetch() : [ result ];
};

const fetchImage = function (url) {
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

fs.readJson(opts.config).then(config => {
    const client = Asana.Client.create().useAccessToken(config.asana.personal_access_token);

    const uploadImageToAsana = function (taskId, file, filename) {
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

    if (!opts.from || !opts.to) {
        console.log('You should select origin and target projects. (from,to)');

        return client.projects.findByTeam(config.asana.team).then(fetch).then(result => {
            console.log(result);
        });
    }

    // test 579942885784874
    // return client.tasks.findByProject(opts.from, {
    //     opt_fields: ['attachments', 'assignee', 'followers', 'created_at', 'completed', 'notes', 'parent', 'tags'].join(',')
    // }).then(fetch).then(result => {
    return client.tasks.findById(579942885784874, {
        opt_fields: ['attachments', 'assignee', 'followers', 'created_at', 'completed', 'notes', 'parent', 'tags', 'stories'].join(',')
    }).then(fetch).then(result => {
        const map = _.indexBy(result, 'id');

        // Grouping by parent
        result = _.compact(_.map(result, item => {
            if (item.parent === null) {
                return item;
            } else if (map[item.parent.id]) {
                map[item.parent.id].children = map[item.parent.id].children || [];
                map[item.parent.id].children.push(item);
                return null;
            }
        }));

        const createTask = function (data) {
            return client.tasks.create({
                assignee: !_.isEmpty(data.assignee) ? data.assignee.id : null,
                followers: !_.isEmpty(data.followers) ? _.pluck(data.followers, 'id') : null,
                name: data.name,
                notes: data.notes,
                memberships: [{
                    project: opts.to
                }],
                tags: !_.isEmpty(data.tags) ? _.pluck(data.tags, 'id') : null
            }).then(result => {
                const task = result;
                const promises = [];

                if (!_.isEmpty(data.attachments)) {
                    promises.push(client.attachments.findByTask(data.id).then(result => {
                        return Promise.mapSeries(result, attachement => {
                            return fetchImage(attachement.view_url).then(image => {
                                return uploadImageToAsana(task.id, image, attachment.name);
                            }).catch(reason => {
                                console.log('Failed to upload attachment', reason);
                            })
                        });
                    }));
                }

                if (!_.isEmpty(data.stories)) {
                    promises.push(client.stories.findByTask(data.id).then(result => {
                        return Promise.mapSeries(result, story => {
                            return client.tasks.addComment(task.id, {
                                text: `${story.created_by.name}: ${story.text}`
                            });
                        });
                    }));
                }

                return Promise.all(promises);
            });
        };

        return Promise.mapSeries(result, item => {
            console.log(item);
        });
    });

    // Prepare asana data to avoid duplicated
        // Executes in order
        // return Promise.mapSeries(files, function (file) {
            // // Creates tasks
            // return Promise.mapSeries(filteredCards, card => {
            //     return client.tasks.create({
            //         assignee: card.idMembers.length ? convertMap(_.first(card.idMembers), config.member) : null,
            //         due_at: card.due,
            //         followers: card.idMembers.length > 1 ? convertMap(card.idMembers, config.member) : [],
            //         name: card.name,
            //         notes: card.desc,
            //         memberships: [{
            //             project: projectData.id,
            //             section: convertMap(card.idList, listToSectionMap)
            //         }],
            //         tags: card.idLabels.length ? convertMap(card.idLabels, labelToTagMap) : [],
            //         projects: [ projectData.id ]
            //     }).then(result => {
            //         var promises = [];
            //         var taskData = result;
            //         cardToTaskMap[card.id] = result.id;
            //         countTask++;

            //         if (countTask % 10 === 0) {
            //             console.log(`${countTask}...`);
            //         }

            //         if (card.idChecklists.length) {
            //             promises.push(
            //                 Promise.mapSeries(convertMap(card.idChecklists.reverse(), checklistMap), checklist => {
            //                     return Promise.mapSeries(checklist.checkItems.reverse(), item => {
            //                         return client.tasks.addSubtask(taskData.id, {
            //                             name: item.name,
            //                             completed: item.state !== 'incomplete'
            //                         });
            //                     }).then(function () {
            //                         return client.tasks.addSubtask(taskData.id, {
            //                             name: `${checklist.name}:`
            //                         });
            //                     });
            //                 })
            //             );
            //         }

            //         if (parseInt(card.badges.comments, 10) > 0) {
            //             promises.push(
            //                 // Trello export has limitation for count of actions as 1000. so we need to request directly trello API.
            //                 trello.getAsync(`/1/cards/${card.id}/actions?limit=1000`).then(result => {
            //                     var comments = _.filter(result, action => {
            //                         return action.type === 'commentCard';
            //                     });

            //                     return Promise.mapSeries(comments.reverse(), comment => {
            //                         var member = convertMap(comment.idMemberCreator, config.member);
            //                         var text = comment.data.text;
            //                         var memberName = member ? convertMap(member, userMap) : comment.memberCreator.fullName;

            //                         text = `${memberName}: ${text} from Trello`;

            //                         return client.tasks.addComment(taskData.id, {
            //                             text: text
            //                         });
            //                     });
            //                 })
            //             );
            //         }

            //         if (card.attachments.length) {
            //             promises.push(
            //                 Promise.mapSeries(card.attachments, attachment => {
            //                     return fetchImage(attachment.url).then(image => {
            //                         return uploadImageToAsana(taskData.id, image, path.basename(attachment.url));
            //                     }).catch(reason => {
            //                         console.log('Failed to upload attachment', reason);
            //                     });
            //                 })
            //             );
            //         }

            //         return Promise.all(promises);
            //     });
            // });
        // });
}).catch(reason => {
    console.error(reason);
}).catch(Promise.CancellationError, function (reason) {
    // nothing to do
});
