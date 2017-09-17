'use strict';

function makeid(num_characters) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < num_characters; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

exports.newString = makeid;