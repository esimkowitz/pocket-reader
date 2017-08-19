/* -*- coding: utf-8 -*- */

/*
Copyright 2017 Evan Simkowitz. All Rights Reserved.
Licensed under the Apache License 2.0 (the "License"). You may not use this file except in 
compliance with the License. A copy of the License is located at
    http://www.apache.org/licenses/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, 
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific 
language governing permissions and limitations under the License.
*/

/*

Currently supports English. (en-US).
 **/

'use strict';

// Use the new Alexa SDK
const Alexa = require('alexa-sdk');

let XMLHttpRequest1 = require("xmlhttprequest").XMLHttpRequest;

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

//The various handlers for interpreting the interaction model from the skill
const handlers = {

    // Launch request - "open skillName" - keep the session open until the user requests to exit
    'LaunchRequest': function () {
        this.attributes['dialogSession'] = true;

        // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
        if (this.event.session.user.accessToken === undefined) {

            this.emit(':tellWithLinkAccountCard',
                LANGUAGE.link_account);
            return;

        }
        this.emit(':ask', LANGUAGE.launchRequestResponse, LANGUAGE.launchRequestResponse);
    },
    // End the Session
    'SessionEndedRequest': function () {
        this.emit('AMAZON.StopIntent');
    },
    'AMAZON.StopIntent': function () {
        this.emit(':tell', LANGUAGE.exit);
    },
    'AMAZON.CancelIntent': function () {
        this.emit(':ask', `${LANGUAGE.okay} ${LANGUAGE.additionalRequests}`);
    },
    'AMAZON.ExitIntent': function () {
        this.emit('AMAZON.StopIntent');
    },
    'FetchArticleIntent': function () {
        // this.emit('Reflect', this.event.request);
        let request = this.event.request;

        // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
        if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
            this.emit(':delegate');
        } else {
            this.emit('FetchArticle');
        }
    },
    'FetchArticle': function () {
        let access_token = this.event.session.user.accessToken;

        // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
        if (access_token === undefined) {

            this.emit(':tellWithLinkAccountCard',
                LANGUAGE.link_account);
            return;

        }
        let slots = this.event.request.intent.slots;

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
            let self = this;
            makeRequest(url, request_data, function (err, res) {
                let response_text = "Failure",
                    card_info = "Failure";
                let article_list = {},
                    sort_id_list = {};
                let count = 0;
                if (!err) {
                    // Gather the titles of the retrieved articles and formulate the announcement
                    if (res.status && res.complete) {
                        article_list = res.list;
                        let article_title_str_spoken = "",
                            article_title_str_written = "";
                        for (let key in article_list) {
                            sort_id_list[article_list[key].sort_id] = key;
                            count++;
                        }
                        for (let i = 0; i < count; ++i) {
                            let article = article_list[sort_id_list[String(i)]];
                            article_title_str_spoken += `${article.resolved_title}, `;
                            article_title_str_written += `* ${article.resolved_title}\n`;
                        }
                        article_title_str_spoken = article_title_str_spoken.substr(0, article_title_str_spoken.length - 2);
                        article_title_str_written = article_title_str_written.substr(0, article_title_str_written.length - 1);
                        response_text = `${LANGUAGE.reading_following}. ${article_title_str_spoken}`;
                        response_text = response_text.replace(/&/g, "and");
                        card_info = `${LANGUAGE.reading_following}:\n\n${article_title_str_written}`;
                    }
                }
                self.attributes['intentOutput'] = response_text;

                // Announce the articles that will be read by Pocket Reader
                // if (self.attributes['dialogSession']) {
                //     self.emit(':askWithCard', response_text, LANGUAGE.still_listening, LANGUAGE.card_title, card_info);
                // } else {
                //     self.emit(':tellWithCard', response_text, LANGUAGE.card_title, card_info);
                // }

                // Use Pocket's Article View API to obtain the parsed text of the articles.
                if (!err && res.status && res.complete) {
                    // For debugging purposes, set count to 1.
                    count = 1;
                    for (let i = 0; i < count; ++i) {
                        let article = article_list[sort_id_list[String(i)]];
                        let request_data = {
                            'consumer_key': String(process.env.POCKET_CONSUMER_KEY),
                            'url': encodeURIComponent(article.given_url),
                            'images': '0',
                            'videos': '0',
                            'refresh': '0',
                            'output': 'json'
                        };
                        let url = 'https://text.getpocket.com/v3/text';
                        makeRequest(url, request_data, function (err, res) {
                            if (!err) {
                                response_text = `${LANGUAGE.reading} ${res.title}.`
                                self.emit(':tell', response_text);
                            }
                        }, "FORM");
                    }
                }
            });
        } else {
            this.emit(':ask', `${LANGUAGE.error} ${LANGUAGE.additionalRequests}`);
        }
    }
};

exports.handler = (event, context) => {
    console.log(JSON.stringify(event));
    console.log(JSON.stringify(context));
    const alexa = Alexa.handler(event, context);
    alexa.registerHandlers(handlers);
    alexa.execute();
};

// This function makes XML HTTP requests to the specified URL containing the specified data in the
// specified format. The response is handled by the specified callback function.
function makeRequest(url, data, callback, method = "JSON") {
    let dataStr = "";
    switch (method) {
        case "FORM":
            {
                for (let name in data) {
                    dataStr += name + '=' + data[name] + '&';
                }
                dataStr = dataStr.substr(0, dataStr.length - 1);
                break;
            }
        default: // case "JSON":
            {
                dataStr = JSON.stringify(data);
                console.log("request body: " + dataStr);
                break;
            }
    }

    let XHR = new XMLHttpRequest1();

    // Define what happens on successful data submission
    XHR.addEventListener('load', function (e) {
        console.log('response: ' + XHR.responseText);
        if (XHR.status !== 200) {
            callback(true, XHR.responseText);
        } else {
            callback(false, JSON.parse(XHR.responseText));
        }
    });

    // Define what happens in case of error
    XHR.addEventListener('error', function (e) {
        callback(e, XHR.response);
    });

    // Set up our request    
    XHR.open('POST', url);
    let content_type = (method === "FORM") ? "application/x-www-form-urlencoded" : "application/json";
    XHR.setRequestHeader('Content-Type', `${content_type}; charset=UTF8`);
    XHR.setRequestHeader('X-Accept', `${content_type}; charset=UTF8`);
    XHR.send(dataStr);
}