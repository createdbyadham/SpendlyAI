# AI-Powered Mobile Receipt Assistant

A Flutter mobile application that helps users track and analyze their expenses using AI and OCR technology.

## Features

- 📸 Capture receipts using the device camera
- 🔍 Automatic text extraction using OCR
- 🤖 AI-powered expense analysis and categorization
- 💬 Natural language queries about expenses
- 📊 View and manage expense history
- 📤 Export data to JSON/CSV
- 🌐 Support for English and Arabic

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/receipt-assistant.git
   cd receipt-assistant
   ```

2. Install dependencies:
   ```bash
   flutter pub get
   ```

3. Create a `.env` file in the root directory and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

4. Run the app:
   ```bash
   flutter run
   ```

## Required Permissions

The app requires the following permissions:
- Camera access for capturing receipts
- Storage access for saving images and exported data

## Dependencies

- Flutter SDK
- Google ML Kit for OCR
- OpenAI API for AI features
- SQLite for local storage
- Various Flutter packages (see pubspec.yaml)

## Project Structure

```
lib/
  ├── models/         # Data models
  ├── screens/        # UI screens
  ├── services/       # Business logic and external services
  └── main.dart       # App entry point
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Flutter team for the amazing framework
- OpenAI for the GPT API
- Google ML Kit for OCR capabilities
# hopntask
"# SpendlyAI" 
