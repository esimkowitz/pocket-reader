'use strict';

const Alexa = require('alexa-sdk');
const constants = require('./constants');
const requests = require('./requests');
const playlist = require('./playlist');

let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
let dynamodb = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1'
});


const DIALOG_DIRECTIVE_SUPPORT = true;

// Series of strings for language tokenization
const LANGUAGE_STRINGS = {
    'en': {
        'launchRequestResponse': 'Welcome to Pocket Reader! If this is your first time, ask for help.',
        'exit': 'Goodbye.',
        'okay': 'Okay.',
        'link_account': 'To start using this skill, please use the Alexa app to link your Pocket account.',
        'received_with': ' received with ',
        'fetching': 'Fetching',
        'reading': 'Reading',
        'reading_following': 'Reading the following articles from Pocket',
        'articles_from_pocket': 'articles from Pocket',
        'slot': ' slot. ',
        'additionalRequests': 'Is there anything else I can help you with?',
        'slots': ' slots. ',
        'still_listening': "I'm still listening,  Please try another intent or say, stop",
        'received_slots_are': 'Received slots are ',
        'card_title': 'Pocket Reader',
        'error': "I'm sorry, I'm not myself today. Let's start over."
    }
}

//Set default language to English unless overridden by the skill request.
let LANGUAGE = LANGUAGE_STRINGS.en;

let stateHandlers = {
    fetchModeIntentHandlers: Alexa.CreateStateHandler(constants.states.FETCH_MODE, {
        'FetchArticleIntent': function () {
            // this.emit('Reflect', this.event.request);
            let request = this.event.request;

            //  Change state to FETCH_MODE
            this.handler.state = constants.states.FETCH_MODE;
            // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
            if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
                this.emit(':delegate');
            } else {
                this.emitWithState('FetchArticle');
            }
        },
        'PlayAudio': function () {
            //  Change state to START_MODE
            this.handler.state = constants.states.START_MODE;
            this.emitWithState('PlayAudio');
        },
        'FetchArticle': function () {
            let access_token = this.event.session.user.accessToken;

            // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
            if (access_token === undefined) {

                this.emit(':tellWithLinkAccountCard',
                    LANGUAGE.link_account);
                return;

            }
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "#token = :access_token",
                ExpressionAttributeNames: {
                    "#token": "access_token"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token
                }
            };
            // console.log("playlist entry query:", params);
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    let params = {
                        RequestItems: {}
                    };
                    params.RequestItems[constants.playlistTableName] = [];
                    for (let i = 0; i < data.Count; ++i) {
                        params.RequestItems[constants.playlistTableName].push({
                            DeleteRequest: {
                                Key: {
                                    "access_token": data.Items[i].access_token,
                                    "order": data.Items[i].order
                                }
                            }
                        });
                    }
                    console.log("delete playlist entries batchWrite:", JSON.stringify(params));
                    dynamodb.batchWrite(params, function (err, data) {
                        if (err) {
                            console.log('ERROR: unable to delete playlist entries: ' + err);
                        } else {
                            console.log('Playlist entries deleted');
                        }
                        let slots = self.event.request.intent.slots;

                        let fetch_data = {
                            'qualifier': 'newest',
                            'number': 1
                        };

                        if (slots) {
                            for (let i in slots) {
                                //Check if there is a value in a given slot
                                switch (slots[i].name) {
                                    case 'Qualifier': // Obtain the resolved qualifier (either 'oldest' or 'newest')
                                        {
                                            if (slots[i].resolutions) {
                                                let resolutions = slots[i].resolutions.resolutionsPerAuthority;
                                                if (resolutions.length > 0) {
                                                    if (resolutions[0].values.length > 0) {
                                                        fetch_data['qualifier'] = resolutions[0].values[0].value.name;
                                                    }
                                                }
                                            }
                                            break;
                                        }
                                    case 'Number': // Obtain the number of articles desired
                                        {
                                            {
                                                fetch_data['number'] = Number(slots[i].value ? slots[i].value : 1);
                                            }
                                            break;
                                        }
                                    default:
                                        {
                                            break;
                                        }
                                }

                            }

                            // Retrieve the n newest|oldest articles using Pocket's Retrieve API
                            let request_data = {
                                "consumer_key": process.env.POCKET_CONSUMER_KEY,
                                "access_token": access_token,
                                "count": fetch_data['number'],
                                "detailType": "simple",
                                "sort": fetch_data['qualifier'],
                                "contentType": "article"
                            };
                            let url = 'https://getpocket.com/v3/get';
                            requests.makeRequest(url, request_data, function (err, res) {
                                let article_list = {},
                                    sort_id_list = {};
                                let count = 0;
                                if (!err) {
                                    if (res.status && res.complete) {
                                        article_list = res.list;
                                        for (let key in article_list) {
                                            sort_id_list[article_list[key].sort_id] = key;
                                            count++;
                                        }
                                    }
                                }

                                // Gather the requested articles, either from the cached audio files or
                                // from Pocket
                                let batchWriteParams = {
                                    RequestItems: {}
                                };
                                batchWriteParams.RequestItems[constants.playlistTableName] = [];

                                if (!err && res.status && res.complete) {
                                    // For debugging purposes, set count to 1.
                                    // count = 1;
                                    let orderCount = 0;
                                    for (let i = 0; i < count; ++i) {
                                        let article = article_list[sort_id_list[String(i)]];
                                        const key = article.resolved_id;

                                        batchWriteParams.RequestItems[constants.playlistTableName].push({
                                            PutRequest: {
                                                Item: {
                                                    access_token: access_token,
                                                    order: orderCount++,
                                                    article_key: key,
                                                    article_url: article.resolved_url,
                                                    curr_index: 0
                                                }
                                            }
                                        });
                                    }
                                }
                                // console.log("put audio asset and playlist entry batchWrite:", JSON.stringify(batchWriteParams));
                                let arrays = [];
                                const size = 25;
                                // console.log("batchWriteParams keys:", JSON.stringify(Object.keys(batchWriteParams.RequestItems)));
                                Object.keys(batchWriteParams.RequestItems).forEach(function (key, index, keys) {
                                    console.log(key, index, keys.length);
                                    let a = batchWriteParams.RequestItems[key];
                                    while (a.length > 0) {
                                        let temp = {
                                            RequestItems: {}
                                        };
                                        temp.RequestItems[key] = a.splice(0, size);
                                        arrays.push(temp);
                                    }
                                    if (index + 1 >= keys.length) {
                                        // console.log("split batchWrite params:", JSON.stringify(arrays));
                                        arrays.forEach(function (params, index, paramsArray) {
                                            dynamodb.batchWrite(params, function (err, data) {
                                                if (err) {
                                                    console.log('ERROR: Dynamo failed: ' + err);
                                                } else {
                                                    console.log('put audio asset and playlist entry batchWrite success');
                                                    if (index + 1 >= paramsArray.length)
                                                        self.emit('PlayAudio');
                                                }
                                            });
                                        });
                                    }
                                });
                            });
                        } else {
                            this.emit(':ask', `${LANGUAGE.error} ${LANGUAGE.additionalRequests}`);
                        }
                    });
                }
            });
        },
        'Unhandled': function () {
            var message = 'Sorry, I could not understand. Please say, play the audio, to begin the audio.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    startModeIntentHandlers: Alexa.CreateStateHandler(constants.states.START_MODE, {
        /*
         *  All Intent Handlers for state : START_MODE
         */
        'FetchArticleIntent': function () {
            let request = this.event.request;

            //  Change state to FETCH_MODE
            this.handler.state = constants.states.FETCH_MODE;
            // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
            if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
                this.emit(':delegate');
            } else {
                this.emitWithState('FetchArticle');
            }
        },
        'LaunchRequest': function () {
            // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
            if (this.event.session.user.accessToken === undefined) {

                this.emit(':tellWithLinkAccountCard',
                    LANGUAGE.link_account);
                return;

            }
            this.emit(':ask', LANGUAGE.launchRequestResponse, LANGUAGE.launchRequestResponse);
        },
        'PlayAudio': function () {
            //  Change state to START_MODE
            this.handler.state = constants.states.START_MODE;
            let access_token = this.event.session.user.accessToken;
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "#token = :access_token",
                ExpressionAttributeNames: {
                    "#token": "access_token"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token
                },
                Select: "COUNT"
            };
            // console.log("playlist numItems query:", JSON.stringify(params));
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    if (!self.attributes['playOrder'] || self.attributes['playOrder'].length !== data.Count) {

                        // console.log("playlist numItems result:", JSON.stringify(data));
                        // Initialize Attributes if undefined.
                        self.attributes['playOrder'] = Array.apply(null, {
                            length: data.Count
                        }).map(Number.call, Number);
                        self.attributes['index'] = 0;
                        self.attributes['offsetInMilliseconds'] = 0;
                        self.attributes['loop'] = false;
                        self.attributes['shuffle'] = false;
                        self.attributes['playbackIndexChanged'] = true;
                    }
                    controller.play.call(self);
                }
            });

        },
        'AMAZON.HelpIntent': function () {
            var message = 'Welcome to the AWS Podcast. You can say, play the audio, to begin the podcast.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        },
        'AMAZON.StopIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'AMAZON.CancelIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest': function () {
            // No session ended logic
        },
        'Unhandled': function () {
            var message = 'Sorry, I could not understand. Please say, play the audio, to begin the audio.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    playModeIntentHandlers: Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
        /*
         *  All Intent Handlers for state : PLAY_MODE
         */
        'FetchArticleIntent': function () {
            // this.emit('Reflect', this.event.request);
            let request = this.event.request;

            //  Change state to FETCH_MODE
            this.handler.state = constants.states.FETCH_MODE;
            // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
            if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
                this.emit(':delegate');
            } else {
                this.emitWithState('FetchArticle');
            }
        },
        'LaunchRequest': function () {
            /*
             *  Session resumed in PLAY_MODE STATE.
             *  If playback had finished during last session :
             *      Give welcome message.
             *      Change state to START_STATE to restrict user inputs.
             *  Else :
             *      Ask user if he/she wants to resume from last position.
             *      Change state to RESUME_DECISION_MODE
             */

            // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
            if (this.event.session.user.accessToken === undefined) {
                this.emit(':tellWithLinkAccountCard',
                    LANGUAGE.link_account);
                return;
            }
            this.attributes['dialogSession'] = true;
            if (this.attributes['playbackFinished']) {
                this.handler.state = constants.states.START_MODE;
                let message = LANGUAGE.launchRequestResponse;
                let reprompt = LANGUAGE.launchRequestResponse;
                this.emit(':ask', message, reprompt);
            } else {
                this.handler.state = constants.states.RESUME_DECISION_MODE;
                this.emitWithState('LaunchRequest');
            }
        },
        'PlayAudio': function () {
            controller.play.call(this)
        },
        'AMAZON.NextIntent': function () {
            controller.playNext.call(this)
        },
        'AMAZON.PreviousIntent': function () {
            controller.playPrevious.call(this)
        },
        'AMAZON.PauseIntent': function () {
            controller.stop.call(this)
        },
        'AMAZON.StopIntent': function () {
            controller.stop.call(this)
        },
        'AMAZON.CancelIntent': function () {
            controller.stop.call(this)
        },
        'AMAZON.ResumeIntent': function () {
            controller.play.call(this)
        },
        'AMAZON.LoopOnIntent': function () {
            controller.loopOn.call(this)
        },
        'AMAZON.LoopOffIntent': function () {
            controller.loopOff.call(this)
        },
        'AMAZON.ShuffleOnIntent': function () {
            controller.shuffleOn.call(this)
        },
        'AMAZON.ShuffleOffIntent': function () {
            controller.shuffleOff.call(this)
        },
        'AMAZON.StartOverIntent': function () {
            controller.startOver.call(this)
        },
        'AMAZON.HelpIntent': function () {
            // This will called while audio is playing and a user says "ask <invocation_name> for help"
            var message = 'You are listening to Pocket Reader. ' +
                'At any time, you can say Pause to pause the audio and Resume to resume.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest': function () {
            // No session ended logic
        },
        'Unhandled': function () {
            var message = 'Sorry, I could not understand. ' +
                'At any time, you can say Pause to pause the audio and Resume to resume.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    remoteControllerHandlers: Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
        /*
         *  All Requests are received using a Remote Control. Calling corresponding handlers for each of them.
         */
        'PlayCommandIssued': function () {
            controller.play.call(this)
        },
        'PauseCommandIssued': function () {
            controller.stop.call(this)
        },
        'NextCommandIssued': function () {
            controller.playNext.call(this)
        },
        'PreviousCommandIssued': function () {
            controller.playPrevious.call(this)
        }
    }),
    resumeDecisionModeIntentHandlers: Alexa.CreateStateHandler(constants.states.RESUME_DECISION_MODE, {
        /*
         *  All Intent Handlers for state : RESUME_DECISION_MODE
         */
        'LaunchRequest': function () {
            let access_token = this.event.session.user.accessToken;
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "(#token = :access_token) AND (#order = :curr_index)",
                ExpressionAttributeNames: {
                    "#token": "access_token",
                    "#order": "order"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token,
                    ":curr_index": this.attributes['playOrder'][this.attributes['index']]
                }
            };
            // console.log("playlist items query:", JSON.stringify(params));
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    var message = 'You were listening to ' + data.Items[0].title +
                        ' Would you like to resume?';
                    var reprompt = 'You can say yes to resume or no to play from the top.';
                    this.response.speak(message).listen(reprompt);
                    this.emit(':responseReady');
                }
            });
        },
        'AMAZON.YesIntent': function () {
            controller.play.call(this)
        },
        'AMAZON.NoIntent': function () {
            controller.reset.call(this)
        },
        'AMAZON.HelpIntent': function () {
            let access_token = this.event.session.user.accessToken;
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "(#token = :access_token) AND (#order = :curr_index)",
                ExpressionAttributeNames: {
                    "#token": "access_token",
                    "#order": "order"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token,
                    ":curr_index": this.attributes['playOrder'][this.attributes['index']]
                }
            };
            // console.log("playlist items query:", JSON.stringify(params));
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    // console.log("playlist items query result:", JSON.stringify(data));
                    var message = 'You were listening to ' + data.Items[0].title +
                        ' Would you like to resume?';
                    var reprompt = 'You can say yes to resume or no to play from the top.';
                    this.response.speak(message).listen(reprompt);
                    this.emit(':responseReady');
                }
            });
        },
        'AMAZON.StopIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'AMAZON.CancelIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest': function () {
            // No session ended logic
        },
        'Unhandled': function () {
            var message = 'Sorry, this is not a valid command. Please say help to hear what you can say.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    })
};

module.exports = stateHandlers;

var controller = function () {
    return {
        play: function () {
            /*
             *  Using the function to begin playing audio when:
             *      Play Audio intent invoked.
             *      Resuming audio when stopped/paused.
             *      Next/Previous commands issued.
             */
            this.handler.state = constants.states.PLAY_MODE;

            if (this.attributes['playbackFinished']) {
                // Reset to top of the playlist when reached end.
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['playbackIndexChanged'] = true;
                this.attributes['playbackFinished'] = false;
            }

            const token = String(this.attributes['playOrder'][this.attributes['index']]);
            const playBehavior = 'REPLACE_ALL';
            const access_token = this.event.session.user.accessToken;
            const curr_index = this.attributes['playOrder'][this.attributes['index']];
            let self = this;
            playlist.getNextAudioAsset(access_token, curr_index, function (audioAsset) {
                console.log("audioAsset", JSON.stringify(audioAsset));
                const offsetInMilliseconds = self.attributes['offsetInMilliseconds'];
                // Since play behavior is REPLACE_ALL, enqueuedToken attribute need to be set to null.
                self.attributes['enqueuedToken'] = null;

                if (canThrowCard.call(self)) {
                    const cardTitle = constants.appTitle;
                    const cardContent = 'Playing ' + audioAsset.title;
                    self.response.cardRenderer(cardTitle, cardContent, null);
                }

                self.response.audioPlayerPlay(playBehavior, audioAsset.url, token, null, offsetInMilliseconds);
                self.emit(':responseReady');
            });
        },
        stop: function () {
            /*
             *  Issuing AudioPlayer.Stop directive to stop the audio.
             *  Attributes already stored when AudioPlayer.Stopped request received.
             */
            this.response.audioPlayerStop();
            this.emit(':responseReady');
        },
        // TODO: Update playNext to play next article, not next audio asset.
        playNext: function () {
            /*
             *  Called when AMAZON.NextIntent or PlaybackController.NextCommandIssued is invoked.
             *  Index is computed using token stored when AudioPlayer.PlaybackStopped command is received.
             *  If reached at the end of the playlist, choose behavior based on "loop" flag.
             */
            let index = this.attributes['index'];
            let access_token = this.event.session.user.accessToken;
            index += 1;
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "#token = :access_token",
                ExpressionAttributeNames: {
                    "#token": "access_token"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token
                },
                Select: "COUNT"
            };
            console.log("database query:", params);
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    // Check for last audio file.
                    if (index === data.Count) {
                        if (self.attributes['loop']) {
                            index = 0;
                        } else {
                            // Reached at the end. Thus reset state to start mode and stop playing.
                            self.handler.state = constants.states.START_MODE;

                            var message = 'You have reached at the end of the playlist.';
                            self.response.speak(message).audioPlayerStop();
                            return self.emit(':responseReady');
                        }
                    }
                    // Set values to attributes.
                    self.attributes['index'] = index;
                    self.attributes['offsetInMilliseconds'] = 0;
                    self.attributes['playbackIndexChanged'] = true;

                    controller.play.call(self);
                }
            });
        },
        // TODO: Update playPrevious to play previous article, not previous audio asset.
        playPrevious: function () {
            /*
             *  Called when AMAZON.PreviousIntent or PlaybackController.PreviousCommandIssued is invoked.
             *  Index is computed using token stored when AudioPlayer.PlaybackStopped command is received.
             *  If reached at the end of the playlist, choose behavior based on "loop" flag.
             */
            let index = this.attributes['index'];
            let access_token = this.event.session.user.accessToken;
            index -= 1;
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "#token = :access_token",
                ExpressionAttributeNames: {
                    "#token": "access_token"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token
                },
                Select: "COUNT"
            };
            console.log("database query:", params);
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    // Check for last audio file.
                    if (index === -1) {
                        if (self.attributes['loop']) {
                            index = data.Count - 1;
                        } else {
                            // Reached at the end. Thus reset state to start mode and stop playing.
                            self.handler.state = constants.states.START_MODE;

                            var message = 'You have reached at the start of the playlist.';
                            self.response.speak(message).audioPlayerStop();
                            return self.emit(':responseReady');
                        }
                    }
                    // Set values to attributes.
                    self.attributes['index'] = index;
                    self.attributes['offsetInMilliseconds'] = 0;
                    self.attributes['playbackIndexChanged'] = true;

                    controller.play.call(self);
                }
            });
        },
        loopOn: function () {
            // Turn on loop play.
            this.attributes['loop'] = true;
            var message = 'Loop turned on.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        loopOff: function () {
            // Turn off looping
            this.attributes['loop'] = false;
            var message = 'Loop turned off.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        shuffleOn: function () {
            // Turn on shuffle play.
            this.attributes['shuffle'] = true;
            shuffleOrder((newOrder) => {
                // Play order have been shuffled. Re-initializing indices and playing first song in shuffled order.
                this.attributes['playOrder'] = newOrder;
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['playbackIndexChanged'] = true;
                controller.play.call(this);
            });
        },
        shuffleOff: function () {
            // Turn off shuffle play. 
            let access_token = this.event.session.user.accessToken;
            let params = {
                TableName: constants.playlistTableName,
                KeyConditionExpression: "#token = :access_token",
                ExpressionAttributeNames: {
                    "#token": "access_token"
                },
                ExpressionAttributeValues: {
                    ":access_token": access_token
                },
                Select: "COUNT"
            };
            console.log("database query:", params);
            let self = this;
            dynamodb.query(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                } else {
                    if (self.attributes['shuffle']) {
                        self.attributes['shuffle'] = false;
                        // Although changing index, no change in audio file being played as the change is to account for reordering playOrder
                        self.attributes['index'] = self.attributes['playOrder'][self.attributes['index']];
                        self.attributes['playOrder'] = Array.apply(null, {
                            length: data.Count
                        }).map(Number.call, Number);
                    }
                    controller.play.call(self);
                }
            });
        },
        // TODO: Change startOver to start at the beginning of the article, not the audioAsset.
        startOver: function () {
            // Start over the current audio file.
            this.attributes['offsetInMilliseconds'] = 0;
            controller.play.call(this);
        },
        reset: function () {
            // Reset to top of the playlist.
            this.attributes['index'] = 0;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;
            controller.play.call(this);
        }
    }
}();

function canThrowCard() {
    /*
     * To determine when can a card should be inserted in the response.
     * In response to a PlaybackController Request (remote control events) we cannot issue a card,
     * Thus adding restriction of request type being "IntentRequest".
     */
    if (this.event.request.type === 'IntentRequest' && this.attributes['playbackIndexChanged']) {
        this.attributes['playbackIndexChanged'] = false;
        return true;
    } else {
        return false;
    }
}

function shuffleOrder(callback) {
    // Algorithm : Fisher-Yates shuffle
    let access_token = this.event.session.user.accessToken;
    let params = {
        TableName: constants.playlistTableName,
        KeyConditionExpression: "#token = :access_token",
        ExpressionAttributeNames: {
            "#token": "access_token"
        },
        ExpressionAttributeValues: {
            ":access_token": access_token
        },
        Select: "COUNT"
    };
    console.log("database query:", params);
    let self = this;
    dynamodb.query(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            var array = Array.apply(null, {
                length: data.Count
            }).map(Number.call, Number);
            var currentIndex = data.Count;
            var temp, randomIndex;

            while (currentIndex >= 1) {
                randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex -= 1;
                temp = array[currentIndex];
                array[currentIndex] = array[randomIndex];
                array[randomIndex] = temp;
            }
            callback(array);
        }
    });
}