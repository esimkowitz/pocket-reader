# Article Reader

_Read Pocket articles with Alexa_

## TODO

1. [ ] Update `playNext` and `playPrevious` actions to play next/previous article, rather than next/previous audio asset.
1. [ ] Add blurb to beginning of each article to announce the title and author
1. [x] Reduce the delay with loading new article segments (maybe cache them in the background?)
1. [x] Figure out how long audio assets should be held onto before discarding
    - Should they be deleted immediately after use?
    - Should I try to incoorporate a smart caching scheme (probably not this one)?
1. [ ] Figure out why the first audio asset is sometimes repeated at the start of an article's playback.
1. [ ] Add support for lists and headers in the HTML parser, also authors.
1. [ ] Add ability to queue unspecified number of articles
    - i.e. play back all articles until told to stop
