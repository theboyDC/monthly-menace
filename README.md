# 💰👿 Monthly Money Menace (M.M.M)

> Your wallet's worst nightmare — automatically find, track, and cancel hidden subscriptions lurking in your inbox.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://reactjs.org/)

---

## 🎯 What It Does

Monthly Money Menace scans your Gmail receipts to **automatically discover recurring subscriptions** you forgot about. It builds a dashboard of everything charging you monthly and **suggests which ones to cancel**.

**Stop paying for what you don't use.**

---

## ✨ Features

- 🔐 **Gmail OAuth Login** — Secure, no password storage
- 📧 **Smart Email Parsing** — Reads receipts, invoices, billing emails
- 🔁 **Recurring Detection** — Identifies patterns (same merchant + amount + interval)
- 📊 **Subscription Dashboard** — See all charges in one place
- 💡 **Cancellation Suggestions** — Highlights wasteful subscriptions
- 🔗 **One-Click Cancel Links** — Direct to merchant cancellation page

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Email API | Google Gmail API |
| Auth | Google OAuth 2.0 |
| Database | SQLite |
| Email Parsing | mailparser |

---

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- Google Cloud Console project with **Gmail API enabled**
- OAuth 2.0 Client ID and Secret

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/monthly-money-menace.git
cd monthly-money-menace

# Install backend
cd backend
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Google OAuth credentials

# Start backend
npm run dev

# Open new terminal for frontend
cd ../frontend
npm install
npm run dev