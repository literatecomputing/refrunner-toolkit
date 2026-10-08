// Content script on RefRunner's own pages (www.refrunner.com, and the dev server once its
// permission is granted): tells the app the Toolkit is installed, and which version, so it
// doesn't offer an install tip. Reads nothing; runs at document_start, before the app.
document.documentElement.dataset.refrunnerToolkit = chrome.runtime.getManifest().version;
