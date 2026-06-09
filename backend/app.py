import os
from flask import Flask, request, jsonify
from flask_mysqldb import MySQL
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow requests from the frontend

# ---------------------------------------------------------------------------
# MySQL configuration
# ---------------------------------------------------------------------------
app.config["MYSQL_HOST"] = os.getenv("MYSQL_HOST", "localhost")
app.config["MYSQL_PORT"] = int(os.getenv("MYSQL_PORT", 3306))
app.config["MYSQL_USER"] = os.getenv("MYSQL_USER", "root")
app.config["MYSQL_PASSWORD"] = os.getenv("MYSQL_PASSWORD", "")
app.config["MYSQL_DB"] = os.getenv("MYSQL_DB", "flask_app")
app.config["MYSQL_CURSORCLASS"] = "DictCursor"

mysql = MySQL(app)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def cursor():
    return mysql.connection.cursor()


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health():
    try:
        cur = cursor()
        cur.execute("SELECT 1")
        cur.close()
        return jsonify({"status": "ok", "db": "connected"})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500


# ---------------------------------------------------------------------------
# Items – CRUD
# ---------------------------------------------------------------------------

@app.route("/api/items", methods=["GET"])
def list_items():
    cur = cursor()
    cur.execute("SELECT * FROM items ORDER BY created_at DESC")
    items = cur.fetchall()
    cur.close()
    return jsonify(items)


@app.route("/api/items/<int:item_id>", methods=["GET"])
def get_item(item_id):
    cur = cursor()
    cur.execute("SELECT * FROM items WHERE id = %s", (item_id,))
    item = cur.fetchone()
    cur.close()
    if item is None:
        return jsonify({"error": "Item not found"}), 404
    return jsonify(item)


@app.route("/api/items", methods=["POST"])
def create_item():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()

    if not name:
        return jsonify({"error": "name is required"}), 400

    cur = cursor()
    cur.execute(
        "INSERT INTO items (name, description) VALUES (%s, %s)",
        (name, description),
    )
    mysql.connection.commit()
    new_id = cur.lastrowid
    cur.close()
    return jsonify({"id": new_id, "name": name, "description": description}), 201


@app.route("/api/items/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()

    if not name:
        return jsonify({"error": "name is required"}), 400

    cur = cursor()
    cur.execute(
        "UPDATE items SET name = %s, description = %s WHERE id = %s",
        (name, description, item_id),
    )
    mysql.connection.commit()
    affected = cur.rowcount
    cur.close()

    if affected == 0:
        return jsonify({"error": "Item not found"}), 404
    return jsonify({"id": item_id, "name": name, "description": description})


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    cur = cursor()
    cur.execute("DELETE FROM items WHERE id = %s", (item_id,))
    mysql.connection.commit()
    affected = cur.rowcount
    cur.close()

    if affected == 0:
        return jsonify({"error": "Item not found"}), 404
    return jsonify({"message": "Deleted"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=debug)
