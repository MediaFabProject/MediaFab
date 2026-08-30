# MediaFab Fork Additions

MediaFab is the visible name of this maintained WidevineProxy2 fork. It keeps the upstream GPL-3.0 foundation and expands the extension into a media-command workflow for protected streams, public manifests, external subtitles, optional metadata handoffs, and sequential Queue Mode processing.

## What This Fork Adds

- Captures public HLS, DASH, Smooth Streaming, and verified direct MP4 media in the same interface as protected Widevine records.
- Preserves current request headers and content keys in the generated N_m3u8DL-RE command.
- Detects external subtitle files from browser traffic and subtitle-specific API or manifest data.
- Downloads verified subtitle sidecars, converts supported formats to SRT, uses Jellyfin-ready video-stem-plus-language filenames, removes duplicates, and rejects signs/forced-only tracks when a full subtitle is available.
- Keeps Additional arguments authoritative so container, quality, audio, subtitle, logging, and muxing choices remain under user control.
- Adds optional post-download handoffs to Media Metadata and Extras Getter (MME) or Live Performance Metadata and Extras Getter (LPMAEG).
- Automatically uses the current Crunchyroll `/watch/...` page for MME and a matching BroadwayHD video page for LPMAEG.
- Adds an optional MediaFab Queue Mode Companion handoff for normal single downloads.
- Adds a dedicated Queue Mode tab for selecting discovered episodes or entering any number of playing-page links manually.
- Uses the same normal command builder in both workflows, including current headers, keys, subtitle handling, cleanup, and optional metadata.
- Processes Queue Mode jobs strictly one at a time through one newly created dedicated browser tab; existing user tabs are never selected as workers.
- Opens each completed command immediately in Terminal through the local companion, shows concise animated phase progress, identifies the exact series and episode, and can close only successful job windows when requested.
- Reuses one unambiguous existing series folder even when MME has added a trailing `(year)`, `(year-year)`, or `(year-)` label.
- Keeps Queue Mode automatic catalogue discovery provider-limited for safety. Crunchyroll and Disney+ are currently supported; manual episode-link queues remain available for other providers.

## Current Queue Mode Boundary

Queue Mode requires the separately installed **MediaFab Queue Mode Companion**. Automatic season and episode discovery currently supports Crunchyroll and Disney+. It opens one dedicated browser tab, captures one episode, dispatches its fresh command immediately, waits for the complete video, subtitle, cleanup, and metadata chain, and only then advances to the next episode.

The Companion is a separately distributed local application and is not included in this repository.

See [README.md](README.md) for the current MediaFab guide and [CHANGELOG.md](CHANGELOG.md) for the maintained implementation history.

---

# Original WidevineProxy2 README

The content below is the upstream README preserved from the fork baseline at commit `801a7488f8c13f4847ed05ec701f150008976e8a`.

# WidevineProxy2
An extension-based proxy for Widevine EME challenges and license messages. \
Modifies the challenge before it reaches the web player and retrieves the decryption keys from the response.

## Features
+ User-friendly / GUI-based
+ Bypasses one-time tokens, hashes, and license wrapping
+ JavaScript native Widevine implementation
+ Supports Widevine Device files
+ Manifest V3 compliant

## Widevine Devices
This addon requires a Widevine Device file to work, which is not provided by this project.
+ Use an existing Remote CDM like [this one](https://github.com/user-attachments/files/21834836/remote.json)
+ Follow [this](https://forum.videohelp.com/threads/408031) guide if you want to dump your own device.
+ Ready-to-use Widevine Devices can be found on the [VideoHelp forum](https://forum.videohelp.com/forums/48).

## Compatibility
+ Compatible (tested) browsers: Firefox/Chrome on Windows/Linux.
+ Works with any service that accepts challenges from Android devices on the same endpoint.

## Installation
+ Chrome
  1. Download the ZIP file from the [releases section](https://github.com/DevLARLEY/WidevineProxy2/releases)
  2. Navigate to `chrome://extensions/`
  3. Enable `Developer mode`
  4. Drag-and-drop the downloaded file into the window
+ Firefox
  + Persistent installation
    1. Download the XPI file from the [releases section](https://github.com/DevLARLEY/WidevineProxy2/releases)
    2. Navigate to `about:addons`
    3. Click the settings icon and choose `Install Add-on From File...`
    4. Select the downloaded file
  + Temporary installation
    1. Download the ZIP file from the [releases section](https://github.com/DevLARLEY/WidevineProxy2/releases)
    2. Navigate to `about:debugging#/runtime/this-firefox`
    3. Click `Load Temporary Add-on...` and select the downloaded file

## Setup
### Widevine Device
If you only have a `device_client_id_blob` and `device_private_key`, run this command to create a .wvd file:
```
pywidevine create-device -k device_private_key -c device_client_id_blob -t "ANDROID" -l 3
```
Now, open the extension, click `Choose File` and select your Widevine Device file.

### Remote CDM
If you don't already have a `remote.json` file, open the API URL in the browser (if provided) and save the response as `remote.json`. \
Now, open the extension, click `Choose remote.json` and select the JSON file provided by your API.


+ Select the type of device you're using in the top right-hand corner
+ The files are saved in the extension's `chrome.storage.sync` storage and will be synchronized across any browsers into which the user is signed in with their Google account.
+ The maximum number of Widevine devices is ~25 **OR** ~200 Remote CDMs
+ Check `Enabled` to activate the message interception and you're done.

## Usage
All the user has to do is to play a DRM protected video and the decryption keys should appear in the `Keys` group box (if the service is not unsupported, as stated above). \
Keys are saved:
+ Temporarily until the extension is either refreshed manually (if installed temporarily) or a removal of the keys is manually initiated.
+ Permanently in the extension's `chrome.storage.local` storage until manually wiped or exported via the command line.
> [!NOTE]
> The video will not play when the interception is active, as the Widevine CDM library isn't able to decrypt the Android CDM license.

+ Click the `+` button to expand the section to reveal the PSSH and keys.

## FAQ
> What if I'm unable to get the keys?

This automatically means that the license server is blocking your CDM and that you either need a CDM from a physical device, a ChromeCDM, or an L1 Android CDM. Don't ask where you can get these

## Issues
+ DRM playback won't work when the extension is disabled and EME Logger is active. This is caused by my fix for dealing with EME Logger interference (solutions are welcome).

## Demo
[Widevineproxy2.webm](https://github.com/user-attachments/assets/8f51cee3-50e2-4aa4-b244-afa2d0b2987e)

## Disclaimer
+ This program is intended solely for educational purposes.
+ Do not use this program to decrypt or access any content for which you do not have the legal rights or explicit permission.
+ Unauthorized decryption or distribution of copyrighted materials is a violation of applicable laws and intellectual property rights.
+ This tool must not be used for any illegal activities, including but not limited to piracy, circumventing digital rights management (DRM), or unauthorized access to protected content.
+ The developers, contributors, and maintainers of this program are not responsible for any misuse or illegal activities performed using this software.
+ By using this program, you agree to comply with all applicable laws and regulations governing digital rights and copyright protections.

## Credits
+ [node-widevine](https://github.com/Frooastside/node-widevine)
+ [forge](https://github.com/digitalbazaar/forge)
+ [protobuf.js](https://github.com/protobufjs/protobuf.js)
