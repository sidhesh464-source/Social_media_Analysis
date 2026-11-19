import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from .routes import api

def create_app():
    load_dotenv()
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "sentimentx-production-secret-key-2026")
    app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH", 20 * 1024 * 1024))
    
    # Enable CORS for Render and local development
    cors_origins = os.getenv("CORS_ORIGINS", "*")
    if cors_origins == "*":
        CORS(app, resources={r"/api/*": {"origins": "*"}})
    else:
        origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
        CORS(app, resources={r"/api/*": {"origins": origins}})

    app.register_blueprint(api, url_prefix="/api")

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error="File exceeds upload limit (20MB)"), 413

    return app
