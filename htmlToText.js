'use strict';

const cheerio = require('cheerio');

// FIXME: Doesn't handle lists, headers
function convert(html) {
    const $ = cheerio.load(html);
    let text = "";
    $('div').find('p').each(function (i, elem) {
        // console.log($(this).text());
        text += `${$(this).text()}\n`;
    });
    // console.log("htmlToText:", text);
    return text.match(/.{1,3000}/g);
}

exports.convert = convert;