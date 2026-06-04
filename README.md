# TeleTransport 🚄✈️
*Time is money*

TeleTransport (also known as Travel Ranker) is a powerful, highly configurable suite designed to search, rank, and compare travel solutions for both trains and flights. 

Instead of just sorting by the lowest base price, TeleTransport uses a **smart scoring system** that evaluates the *actual* cost of a trip by factoring in travel time, early departure penalties, late arrival penalties, connection inconveniences, and extra airport costs.

## 🌟 What's New
We have completely overhauled TeleTransport! Moving from a simple CLI tool, TeleTransport now features a **beautiful, fully responsive Next.js frontend GUI** with deep customization options, local persistence, and extensive deployment capabilities.

### 🔥 Immense New Features
- **Stunning Next.js GUI**: A brand new, beautifully designed frontend built with React and Next.js, featuring smooth animations (Framer Motion), dark/light mode toggle, and a sleek glassmorphism aesthetic.
- **Advanced State Persistence**: Search results, UI settings, active tabs, and input data are persisted in `localStorage` and `sessionStorage`. If you accidentally reload, your data is safe!
- **Extensive UI Customization**: Manage all your default origins, destinations, and dropdown options directly from a unified Settings menu inside the app.
- **Granular Airport Extra Costs**: Traveling to the airport takes time and fuel. Now you can assign specific fuel costs and driving times (for you and your companions) to specific IATA codes. The app will factor these into the final `adjusted_cost`.
- **Text Reminders**: Add custom alerts (e.g., "Don't forget the Booking.com discount!") that display prominently when searching for flights or trains.
- **Internationalization (i18n)**: Fully bilingual support (English and Italian) with a comprehensive integrated guide on how scoring works.
- **Markdown Export**: Found the perfect solutions? Click "Copy Table" to instantly copy the results formatted as Markdown, ready to be pasted into your notes or chats.
- **Keyboard Shortcuts**: Power user? Use `Alt+1` for Trains, `Alt+2` for Flights, `Ctrl+Enter` to search, and `Escape` to close modals.


---

## ⚙️ How Scoring Works (The "Adjusted Cost")

The core philosophy of TeleTransport is that **Time is Money**. The system ranks solutions based on the lowest `adjusted_cost`:

```text
Adjusted Cost = Ticket Price
              + (Duration Hours * Time Value)
              + (Companions Duration Hours * Companions Time Value)
              + Early Departure Penalty
              + Late Arrival Penalty (including Overnights)
              + (Connections * Connection Penalty)
              + Airport Specific Extra Costs (Fuel + Drive Time)
```

You can customize *every single variable* directly from the Settings page in the web app, allowing you to tailor the algorithm exactly to your travel style and budget.

---

## 💻 Installation & Local Setup

### 1. Requirements
- **Python 3.9+**
- **Node.js 18+**
- **SerpApi API Key** (Required for Flights)

### 2. Backend Setup
```powershell
cd C:\TeleTransport\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install
```
*(Make sure you have an `.env` file with your `SERPAPI_KEY` as explained in the legacy CLI setup).*

### 3. Frontend Setup
```powershell
cd C:\TeleTransport\frontend
npm install
npm run dev
```
The app will be available at `http://localhost:3000`.

### 4. Legacy CLI Tools
The classic CLI tools (`voli.bat` and `treni.bat`) and the `travel_ranker.toml` configurations are still fully functional if you prefer the terminal!

---

## 🔮 Future Improvements / Roadmap
- [ ] Incorporate **Italo Treno** support (specifically for routes like Milan-Turin).
