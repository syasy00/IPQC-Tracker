# IPQC-Tracker

In-Process Quality Control (IPQC) dashboard for semiconductor manufacturing, featuring audit tracking, guideline checklists, and real-time findings analysis.

## Features

- **Daily Audit Logging** - Record IPQC findings with detailed information
- **Analytics Dashboard** - Real-time production insights and compliance tracking
- **Audit History** - Full audit trail and historical data exploration
- **Quality Guidelines** - Centralized checklist management
- **Evidence Tracking** - Attach images to audit records
- **Power BI Integration** - Optional Power BI report embedding

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/syasy00/IPQC-Tracker.git
   cd IPQC-Tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Add your `GEMINI_API_KEY` if needed

## Running Locally

Start the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

## Build for Production

```bash
npm run build
```

## Project Structure

- `src/App.tsx` - Main application component
- `src/types.ts` - TypeScript type definitions
- `src/index.css` - Styling with Tailwind CSS
- `public/` - Static assets including AE.png logo

## Technologies Used

- React 19
- TypeScript
- Tailwind CSS 4
- Recharts - Data visualization
- Lucide React - Icons
- Framer Motion - Animations

## License

Private - Proprietary
