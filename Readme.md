# Article Reader

_Read Pocket articles with Alexa_

## TODO

1. [ ] Update `playNext` and `playPrevious` actions to play next/previous article, rather than next/previous audio asset.
1. [x] Add blurb to beginning of each article to announce the title and author
1. [x] Reduce the delay with loading new article segments (maybe cache them in the background?)
1. [x] Figure out how long audio assets should be held onto before discarding
    - Should they be deleted immediately after use?
    - Should I try to incoorporate a smart caching scheme (probably not this one)?
1. [ ] Figure out why the first audio asset is sometimes repeated at the start of an article's playback.
1. [ ] Add support for lists and headers in the HTML parser, also authors.
1. [x] Implement a system to delete left-over Polly Queue table entries and audio assets when a playlist entry is deleted.
1. [ ] Add ability to queue unspecified number of articles
    - i.e. play back all articles until told to stop
1. [ ] Streamline the process for deleting old assets
    - Maybe keep a list of currently-downloaded assets in the playlist object so fewer repeat queries need to be done
    - Or combine all the audio asset objects into one list object with an index marker
1. [ ] Streamline the cleanup phase so that old audio assets are reliably deleted
    - Maybe keep track of when an asset was last played and delete it when it's been idle for too long
