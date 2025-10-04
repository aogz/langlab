# LangLab Selector & Translator

A Chrome browser extension that enables interactive word selection and client-side translation on any webpage, inspired by LangLab's highlighting functionality.

## Features

- **Interactive Word Selection**: Click and drag to select words on any webpage
- **Real-time Translation**: Get instant translations using on-device translation APIs
- **Sidebar Interface**: Clean, modern sidebar for viewing translations and managing settings
- **Language Detection**: Automatically detects source language for better translation accuracy
- **Customizable Settings**: Configure your native language and target learning language
- **No Backend Required**: All translation happens client-side for privacy and speed
- **Draggable Popup**: Move translation popups around the page for better positioning

## How It Works

1. **Word Selection**: Hold Alt/Option and click on any text block to activate the word selection overlay
2. **Highlight Words**: Click on individual words to highlight them for translation
3. **View Translation**: Selected words appear in the sidebar with their translations
4. **Manage Settings**: Configure your language preferences through the extension options

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/langlab.git
   cd langlab
   ```

2. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `src` folder

3. Configure your languages:
   - Click the extension icon and select "Options"
   - Set your native language (e.g., "en" for English)
   - Set the language you're learning (e.g., "nl" for Dutch)
   - Click "Save"

## Usage

### Basic Word Selection
1. Navigate to any webpage
2. Hold the Alt/Option key and click on a text block
3. Click on individual words to highlight them
4. View translations in the sidebar

### Advanced Features
- **Drag Popup**: Click and drag the translation popup to reposition it
- **Collapse/Expand**: Use the controls in the popup to minimize or expand the translation view
- **Language Switching**: Change translation direction using the language controls

## Technical Details

- **Manifest V3**: Built with the latest Chrome extension architecture
- **Content Scripts**: Runs on all websites with minimal performance impact
- **Client-side Translation**: Uses on-device translation APIs for privacy
- **Modern UI**: Clean, dark-themed interface with responsive design
- **Cross-site Compatibility**: Works on any website without conflicts

## File Structure

```
src/
├── manifest.json          # Extension configuration
├── content.js            # Main content script for word selection
├── sidebar.html          # Sidebar interface
├── sidebar.js            # Sidebar functionality
├── options.html          # Settings page
├── options.js            # Settings functionality
├── service-worker.js     # Background script
├── styles.css            # Extension styles
└── page-prompt.js        # Page interaction utilities
```

## Permissions

The extension requires the following permissions:
- `activeTab`: Access to the current tab for word selection
- `scripting`: Inject content scripts for functionality
- `storage`: Save user preferences
- `sidePanel`: Display the translation sidebar
- `<all_urls>`: Work on any website

## Development

### Prerequisites
- Chrome browser (latest version)
- Basic knowledge of Chrome extension development

### Building
No build process required - the extension runs directly from the source files.

### Testing
1. Load the extension in developer mode
2. Test on various websites
3. Verify translation accuracy and UI responsiveness

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by Weblang's word highlighting functionality
- Built with modern web technologies and Chrome extension APIs
- Designed for language learners and multilingual users