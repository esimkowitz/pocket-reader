# Article Reader

_Read Pocket articles with Alexa_

## TODO

1. [x] Add blurb to beginning of each article to announce the title and author
1. [x] Reduce the delay with loading new article segments (maybe cache them in the background?)
1. [x] Figure out how long audio assets should be held onto before discarding
    - Should they be deleted immediately after use?
    - Should I try to incoorporate a smart caching scheme (probably not this one)?
1. [ ] Add support for lists and headers in the HTML parser, also authors.
1. [x] Implement a system to delete left-over Polly Queue table entries and audio assets when a playlist entry is deleted.
1. [ ] Add ability to queue unspecified number of articles
    - i.e. play back all articles until told to stop
1. [x] Streamline the process for deleting old assets
    - Maybe keep a list of currently-downloaded assets in the playlist object so fewer repeat queries need to be done
    - Or combine all the audio asset objects into one list object with an index marker
1. [x] Streamline the cleanup phase so that old audio assets are reliably deleted
    - Maybe keep track of when an asset was last played and delete it when it's been idle for too long
1. [ ] Try implementing an automated deploy pipeline for the skill by following [this tutorial](https://stelligent.com/2017/07/25/use-aws-codepipeline-to-deploy-amazon-alexa-skill/).
1. [ ] Simplify the tracking of playlists, current index within an article, etc. by using the `this.attributes` object instead of a separate table.
1. [ ] Look at [bespoken.io](https://bespoken.io/) as an option for easier skill development

## FIXME

1. [ ] Update `playNext` and `playPrevious` actions to play next/previous article, rather than next/previous audio asset.
1. [ ] When more than one item is queued in the playlist, the numSlices attribute is sometimes copied from the first item
1. [ ] When only one item is queued to the playlist, sometimes a second ghost item is added with no attributes other than a copy of the first item's `numSlices`
1. [x] Figure out why the first audio asset is sometimes repeated at the start of an article's playback.
