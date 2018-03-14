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
            },
            start: {
                help: 'Start task id'
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

    const taskOptions = {
        opt_fields: ['name', 'attachments', 'assignee', 'followers', 'created_at', 'completed', 'notes', 'parent', 'subtasks', 'tags'].join(',')
    };

    // test 579942885784874
    // return client.tasks.findById(579942885784874, taskOptions).then(fetch).then(result => {
    return client.tasks.findByProject(opts.from, taskOptions).then(fetch).then(result => {
        const createTask = function createTask(data, parentTask) {
            const insertData = {
                assignee: !_.isEmpty(data.assignee) ? data.assignee.id : null,
                followers: !_.isEmpty(data.followers) ? _.pluck(data.followers, 'id') : [],
                name: data.name,
                notes: data.notes,
                tags: !_.isEmpty(data.tags) ? _.pluck(data.tags, 'id') : []
            };

            let promise = Promise.resolve();

            if (parentTask) {
                insertData.workspace = opts.workspace;

                promise = client.tasks.addSubtask(parentTask.id, insertData);
            } else {
                _.extend(insertData, {
                    memberships: [{
                        project: opts.to
                    }],
                    projects: [ opts.to ] // projects 혹은 workspace를 명시해줘야 한다
                });

                promise = client.tasks.create(insertData);
            }

            return promise.then(result => {
                const task = result;
                const promises = [];

                if (!_.isEmpty(data.subtasks)) {
                    promises.push(client.tasks.subtasks(data.id, taskOptions).then(fetch).then(result => {
                        return Promise.mapSeries(result, data => {
                            return createTask(data, task);
                        });
                    }));
                }

                if (!_.isEmpty(data.attachments)) {
                    promises.push(client.attachments.findByTask(data.id, {
                        opt_fields: ['name', 'view_url'].join(',')
                    }).then(fetch).then(result => {
                        return Promise.mapSeries(result, attachment => {
                            return fetchImage(attachment.view_url).then(image => {
                                return uploadImageToAsana(task.id, image, attachment.name);
                            }).catch(reason => {
                                console.log('Failed to upload attachment', reason);
                            })
                        });
                    }));
                }

                if (!_.isEmpty(data.stories)) {
                    promises.push(client.stories.findByTask(data.id).then(fetch).then(result => {
                        return Promise.mapSeries(result, story => {
                            return client.tasks.addComment(task.id, {
                                text: `${story.created_by.name}: ${story.text}`
                            });
                        });
                    }));
                }

                if (!_.isEmpty(promises)) {
                    return Promise.all(promises);
                } else {
                    return;
                }
            });
        };

        if (opts.start) {
            _.some(result, (v, i) => {
                // type 비교를 안함
                if (v.id == opts.start) {
                    result = result.slice(i);
                    console.log(`${v.id} 이후부터 시작합니다.`);
                    return true;
                }
            });
        }

        return Promise.mapSeries(result, item => {
            return createTask(item).then(() => {
                console.log(`${item.id} task copied.`);
            });
        });
    });
}).catch(reason => {
    console.error(util.inspect(reason, null, 4));
}).catch(Promise.CancellationError, function (reason) {
    // nothing to do
});
