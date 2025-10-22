# Divine Bridge

> A global prayer community that unites hearts in faith through daily prayers, verses, and testimonies.

[![Live Site](https://img.shields.io/badge/Live-divinebridge.io-blue)](https://divinebridge.io)
[![Python](https://img.shields.io/badge/Python-3.8+-green)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0+-red)](https://flask.palletsprojects.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Auth-orange)](https://firebase.google.com/)

---

## 🌟 Features

- **Daily Prayer & Verse** - AI-generated prayers and curated Bible verses delivered daily
- **Prayer Room** - Community space for prayer requests and testimonies
- **Thanksgiving Wall** - Share stories of God's faithfulness
- **Disaster Support** - Targeted prayers for global crises and disasters
- **Email Notifications** - Daily content delivered at 6 AM your time
- **Organization Network** - Connect with local and global ministries
- **Social Sharing** - Share prayers and testimonies easily

---

## 📁 Repository Structure

```
divineBridge/
├── app.py                     # Main Flask application
├── config.py                  # Configuration & secrets management
├── requirements.txt           # Python dependencies
├── Dockerfile                 # Container configuration
├── 
├── routes/                    # API blueprints
│   ├── auth_bp.py            # Authentication endpoints
│   ├── prayer_bp.py          # Prayer request endpoints
│   ├── testimony_bp.py       # Testimony endpoints
│   ├── verse_bp.py           # Daily verse endpoints
│   ├── email_bp.py           # Email service endpoints
│   └── seo_bp.py             # SEO & disaster pages
├── 
├── Core Services              # (Root directory)
│   ├── prayer_generator.py   # AI prayer generation
│   ├── verse_generator.py    # Verse selection logic
│   ├── storage_handler.py    # Cloud Storage integration
│   ├── content_moderator.py  # AI moderation
│   ├── image_generator.py    # Daily image creation
│   └── ...more services
├── 
├── templates/                 # HTML templates
├── static/                    # CSS, JS, images
├── 
├── tests/                     # Test files
├── scripts/                   # Utility scripts
├── 
└── docs/                      # 📚 Documentation
    ├── README.md             # Documentation index
    ├── deployment/           # Deployment guides
    ├── guides/               # Setup guides
    ├── legal/                # Legal documents
    └── reports/              # Technical reports
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- Google Cloud Project (for Firebase & Storage)
- Perplexity API Key (for AI generation)

### Local Development

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/divinebridge.git
cd divinebridge
```

2. **Create virtual environment:**
```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
```

3. **Install dependencies:**
```bash
pip install -r requirements.txt
```

4. **Set up environment variables:**
```bash
export USE_LOCAL_STORAGE=true  # Test without affecting production
export FLASK_ENV=development
```

5. **Run the application:**
```bash
python app.py
```

Visit `http://localhost:5001`

📖 **Detailed Setup:** See [Quick Testing Guide](docs/guides/QUICKSTART_TESTING.md)

---

## 📚 Documentation

Comprehensive documentation is available in the `/docs` directory:

### For Developers
- **[Quick Testing Guide](docs/guides/QUICKSTART_TESTING.md)** - Get started in 5 minutes
- **[Local Storage Guide](docs/guides/LOCAL_STORAGE_GUIDE.md)** - Test safely
- **[System Review](docs/reports/SYSTEM_REVIEW_REPORT.md)** - Architecture overview

### For Deployment
- **[Deployment Summary](docs/deployment/DEPLOYMENT_SUMMARY.md)** - Complete deployment guide
- **[Deployment Checklist](docs/deployment/FINAL_DEPLOYMENT_CHECKLIST.md)** - Pre-flight checks
- **[Cloud Scheduler Setup](docs/deployment/CLOUD_SCHEDULER_SETUP.md)** - Automated tasks

### For Configuration
- **[Email Setup](docs/guides/EMAIL_CONFIGURATION_GUIDE.md)** - Email service configuration
- **[Google Sign-In](docs/guides/GOOGLE_SIGNIN_SETUP.md)** - OAuth setup
- **[SEO Strategy](docs/reports/SEO_STRATEGY.md)** - SEO implementation

### Features Documentation
- **[Testimony System](docs/reports/TESTIMONY_APPROVAL_REVIEW.md)** - How testimonies work
- **[UX Improvements](docs/reports/UX_IMPROVEMENTS_SUMMARY.md)** - Latest UX features
- **[Security Audit](docs/reports/SECURITY_AUDIT_REPORT.md)** - Security measures

**[📖 Full Documentation Index](docs/README.md)**

---

## 🛠️ Technology Stack

### Backend
- **Flask** - Web framework
- **Firebase** - Authentication & Firestore
- **Google Cloud Storage** - File storage
- **Perplexity AI** - Prayer generation & moderation

### Frontend
- **HTML/CSS/JavaScript** - No framework (vanilla)
- **Glassmorphism UI** - Modern design
- **Responsive Design** - Mobile-first

### Infrastructure
- **Google Cloud Run** - Serverless deployment
- **Cloud Scheduler** - Automated tasks
- **Secret Manager** - Secure credentials

---

## 🔒 Security

Security is our top priority. We implement:

- ✅ CSRF Protection (Flask-WTF)
- ✅ Rate Limiting (Flask-Limiter)
- ✅ Input Validation & Sanitization
- ✅ AI Content Moderation
- ✅ Secure Headers (CSP, HSTS, etc.)
- ✅ Non-root Docker containers
- ✅ Secret Manager for credentials

**[Full Security Audit Report](docs/reports/SECURITY_AUDIT_REPORT.md)**

---

## 🧪 Testing

### Run Tests
```bash
# Test with local storage (safe)
export USE_LOCAL_STORAGE=true
python tests/test_local_moderation.py

# Test production fixes
python tests/test_production_fixes.py
```

### Available Test Suites
- `test_thanksgiving_system.py` - Testimony feature tests
- `test_local_moderation.py` - Content moderation tests
- `test_deployment_ready.py` - Deployment readiness
- `final_deployment_check.py` - Pre-deployment verification

---

## 📊 Key Features in Detail

### 🙏 Prayer Generation
- AI-powered daily prayers (150-250 words)
- Context-aware for disasters and events
- Strict content validation
- Biblical language and format

### 📖 Daily Verse
- Curated Bible verses
- Beautiful shareable images (1080x1080)
- Automatic caching
- Social media optimized

### ✨ Testimony System
- 8 categorized types (Healing, Provision, etc.)
- AI moderation (auto-approval)
- Share functionality
- User profiles with stats

### 🌍 Disaster Support
- Auto-detected global events
- Targeted prayers for affected areas
- SEO-optimized landing pages
- Integration with relief organizations

---

## 📧 Email Service

Daily emails sent at 6 AM ET with:
- Daily prayer
- Daily verse
- Beautiful HTML design
- Mobile-optimized
- Easy unsubscribe

**[Email Configuration Guide](docs/guides/EMAIL_CONFIGURATION_GUIDE.md)**

---

## 🚀 Deployment

### Production Deployment
```bash
# Build and deploy to Cloud Run
gcloud run deploy divinebridge \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

**[Complete Deployment Guide](docs/deployment/DEPLOYMENT_SUMMARY.md)**

---

## 🤝 Contributing

We welcome contributions! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Test** locally with `USE_LOCAL_STORAGE=true`
4. **Commit** changes (`git commit -m 'Add amazing feature'`)
5. **Push** to branch (`git push origin feature/amazing-feature`)
6. **Open** a Pull Request

### Development Guidelines
- Never deploy without local testing
- Keep documentation updated
- Follow existing code style
- Add tests for new features
- Use local storage for testing

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🌐 Links

- **Live Site:** [divinebridge.io](https://divinebridge.io)
- **Prayer Room:** [divinebridge.io/prayers](https://divinebridge.io/prayers)
- **Documentation:** [docs/README.md](docs/README.md)

---

## 💬 Support

For questions or support:
- Visit our [FAQ](https://divinebridge.io/faq)
- Contact us through the [website](https://divinebridge.io/contact)

---

**Built with ❤️ for the global faith community**

*Last Updated: October 21, 2025*

