# X to Bluesky Reposter Chrome Extension

A Chrome extension that allows you to easily repost content from X.com (Twitter) to Bluesky with a single click.

## Features

- **Seamless Integration**: Adds a "Repost to Bluesky" option directly in X.com's post menu
- **OAuth Authentication**: Secure connection to your Bluesky account using app passwords
- **Content Preservation**: Maintains original post text and images when reposting
- **Comment Support**: Add your own commentary before reposting
- **Intuitive UI**: Clean, modern interface that matches X.com's design

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `x-to-bluesky-extension` folder
5. The extension icon will appear in your Chrome toolbar

## Setup

1. Click the extension icon in your toolbar
2. You'll need to create an app password for Bluesky:
   - Go to [Bluesky App Passwords](https://bsky.app/settings/app-passwords)
   - Create a new app password
   - Copy the password (you won't be able to see it again)
3. Enter your Bluesky handle (username.bsky.social) or email
4. Enter the app password you just created
5. Click "Connect to Bluesky"

## How to Use

1. Navigate to X.com
2. Find a post you want to share to Bluesky
3. Click the "..." (three dots) menu on the post
4. Select "Repost to Bluesky" from the menu
5. Optionally add your own comment in the modal that appears
6. Click "Post to Bluesky"

## Features in Detail

### Authentication
- Uses Bluesky's official API with app passwords for security
- Credentials are stored securely in Chrome's local storage
- Session management with automatic refresh

### Content Handling
- Extracts post text, images, and metadata
- Preserves formatting and links
- Supports image uploads to Bluesky
- Handles mentions and hashtags

### User Interface
- Modal dialog for adding comments before reposting
- Visual feedback for successful posts
- Error handling with clear messages
- Responsive design that works on all screen sizes

## Privacy & Security

- No data is sent to third-party servers
- All communication is directly between your browser and Bluesky's API
- App passwords provide limited access (cannot change account settings)
- You can disconnect at any time through the extension popup

## Troubleshooting

### Extension doesn't appear on X.com
- Make sure the extension is enabled in Chrome
- Refresh the X.com page
- Check that you're on x.com or twitter.com

### Authentication fails
- Ensure you're using an app password, not your main password
- Check that your handle is correct (include .bsky.social)
- Try creating a new app password

### Posts fail to send
- Check your internet connection
- Ensure you're still logged in to Bluesky
- Try disconnecting and reconnecting your account

## Technical Details

- **Manifest Version**: 3
- **Permissions**: storage, identity, tabs
- **Content Scripts**: Injected into X.com pages
- **Background Service Worker**: Handles API communication
- **APIs Used**: Bluesky AT Protocol (atproto)

## Development

To modify the extension:

1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload X.com to see your changes

## License

MIT License - Feel free to modify and distribute

## Contributing

Contributions are welcome! Please feel free to submit pull requests or report issues.

## Disclaimer

This extension is not affiliated with X Corp. or Bluesky Social. Use at your own discretion.