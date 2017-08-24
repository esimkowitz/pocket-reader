'use strict';

const cheerio = require('cheerio');

function convert(html) {
    const $ = cheerio.load(html);
    let text = "";
    $('div').find('p').each(function (i, elem) {
        // console.log($(this).text());
        text += `${$(this).text()}\n\n`;
    });
    console.log("htmlToText:", text);
    return text.match(/.{1,3000}/g);
}

exports.convert = convert;