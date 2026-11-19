# Deploying SentimentX to Render (render.com)

SentimentX is fully architected for **Render's Free Tier** using:
1. **`sentimentx-api`**: Python Web Service (Flask + Gunicorn, NoSQL / Firebase Realtime Database)
2. **`sentimentx-frontend`**: Static Site (React + Vite + Firebase Realtime Database)

---

## Method 1: Automated 1-Click Blueprint (Recommended)

1. **Push your code to a Git repository** (GitHub or GitLab):
   ```bash
   git init
   git add .
   git commit -m "SentimentX with Firebase Realtime Database and Render Blueprint"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy via Render Blueprint**:
   - Log into [Render Dashboard](https://dashboard.render.com).
   - Click **New +** > **Blueprint**.
   - Connect your GitHub repository.
   - Render automatically reads `render.yaml` and sets up both the `sentimentx-api` and `sentimentx-frontend` services.
   - Click **Apply**. Render will build and deploy both services automatically!

---

## Method 2: Manual Service Creation

If you prefer to configure services manually in the Render UI:

### Step 1: Deploy Backend (`sentimentx-api`)
- In Render Dashboard, click **New +** > **Web Service**.
- Select your repository.
- Configure settings:
  - **Name**: `sentimentx-api`
  - **Root Directory**: `backend`
  - **Runtime**: `Python 3`
  - **Build Command**: `pip install -r requirements.txt`
  - **Start Command**: `gunicorn run:app --bind 0.0.0.0:$PORT`
- Add Environment Variables:
  - `FLASK_ENV`: `production`
  - `SECRET_KEY`: *(click Generate)*
  - `CORS_ORIGINS`: `*`
  - `HADOOP_ENABLED`: `false`
  - `FIREBASE_DATABASE_URL`: `https://social-media-sentiment-ana-default-rtdb.asia-southeast1.firebasedatabase.app`
  - `FIREBASE_PROJECT_ID`: `social-media-sentiment-ana`
- Click **Deploy Web Service**.
- Copy the generated URL (e.g., `https://sentimentx-api.onrender.com`).

### Step 2: Deploy Frontend (`sentimentx-frontend`)
- In Render Dashboard, click **New +** > **Static Site**.
- Select your repository.
- Configure settings:
  - **Name**: `sentimentx-frontend`
  - **Root Directory**: `frontend`
  - **Build Command**: `npm install && npm run build`
  - **Publish Directory**: `dist`
- Add Redirects/Rewrites (Under Settings > Redirects/Rewrites):
  - **Source**: `/*`
  - **Destination**: `/index.html`
  - **Action**: `Rewrite`
- Add Environment Variables:
  - `VITE_API_BASE_URL`: `https://sentimentx-api.onrender.com/api` *(use your backend URL from Step 1)*
  - `VITE_FIREBASE_API_KEY`: `AIzaSyD_wprK4cwYRi9BYULfUYrd6nvUAlNPn3c`
  - `VITE_FIREBASE_AUTH_DOMAIN`: `social-media-sentiment-ana.firebaseapp.com`
  - `VITE_FIREBASE_DATABASE_URL`: `https://social-media-sentiment-ana-default-rtdb.asia-southeast1.firebasedatabase.app`
  - `VITE_FIREBASE_PROJECT_ID`: `social-media-sentiment-ana`
  - `VITE_FIREBASE_STORAGE_BUCKET`: `social-media-sentiment-ana.firebasestorage.app`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`: `510984607074`
  - `VITE_FIREBASE_APP_ID`: `1:510984607074:web:2c12b3fa66483e7111483b`
- Click **Create Static Site**.

---

## Important Firebase Console Settings for Production

1. **Authorized Domains**:
   - Go to [Firebase Console](https://console.firebase.google.com/) > `social-media-sentiment-ana` > **Authentication** > **Settings** > **Authorized domains**.
   - Click **Add domain** and enter your Render frontend domain (e.g. `sentimentx-frontend.onrender.com`).
   - *(This allows Google Popup Sign-In and secure redirects on Render).*

2. **Realtime Database Rules**:
   - In Firebase Console > **Realtime Database** > **Rules**:
   - For authenticated users:
     ```json
     {
       "rules": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
     ```
   - *(Or for public access during grading/testing):*
     ```json
     {
       "rules": {
         ".read": true,
         ".write": true
       }
     }
     ```
