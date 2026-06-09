/* app.js – handles all API calls and DOM updates */

const form       = document.getElementById("item-form");
const editIdInput= document.getElementById("edit-id");
const nameInput  = document.getElementById("name");
const descInput  = document.getElementById("description");
const submitBtn  = document.getElementById("submit-btn");
const cancelBtn  = document.getElementById("cancel-btn");
const formTitle  = document.getElementById("form-title");
const itemsBody  = document.getElementById("items-body");
const banner     = document.getElementById("banner");

// ---------------------------------------------------------------------------
// Banner helpers
// ---------------------------------------------------------------------------

function showBanner(msg, type = "success") {
  banner.textContent = msg;
  banner.className = `banner ${type}`;
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { banner.className = "banner hidden"; }, 3500);
}

// ---------------------------------------------------------------------------
// Load and render items
// ---------------------------------------------------------------------------

async function loadItems() {
  try {
    const res = await fetch(`${API_BASE}/api/items`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    renderItems(items);
  } catch (err) {
    itemsBody.innerHTML = `<tr><td colspan="5" class="empty error">Failed to load items: ${err.message}</td></tr>`;
  }
}

function renderItems(items) {
  if (!items.length) {
    itemsBody.innerHTML = `<tr><td colspan="5" class="empty">No items yet. Create one above.</td></tr>`;
    return;
  }
  itemsBody.innerHTML = items.map(item => `
    <tr>
      <td>${item.id}</td>
      <td>${escHtml(item.name)}</td>
      <td>${escHtml(item.description || "")}</td>
      <td>${formatDate(item.created_at)}</td>
      <td class="row-actions">
        <button class="btn btn-small btn-secondary" onclick="startEdit(${item.id}, ${JSON.stringify(escHtml(item.name))}, ${JSON.stringify(escHtml(item.description || ""))})">Edit</button>
        <button class="btn btn-small btn-danger"    onclick="deleteItem(${item.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

// ---------------------------------------------------------------------------
// Form – create / update
// ---------------------------------------------------------------------------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id   = editIdInput.value;
  const body = { name: nameInput.value.trim(), description: descInput.value.trim() };

  try {
    let res;
    if (id) {
      res = await fetch(`${API_BASE}/api/items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch(`${API_BASE}/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    showBanner(id ? "Item updated." : "Item created.");
    resetForm();
    loadItems();
  } catch (err) {
    showBanner(err.message, "error");
  }
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function startEdit(id, name, description) {
  editIdInput.value  = id;
  nameInput.value    = name;
  descInput.value    = description;
  formTitle.textContent = "Edit Item";
  submitBtn.textContent = "Update";
  cancelBtn.classList.remove("hidden");
  nameInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

cancelBtn.addEventListener("click", resetForm);

function resetForm() {
  form.reset();
  editIdInput.value     = "";
  formTitle.textContent = "New Item";
  submitBtn.textContent = "Create";
  cancelBtn.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function deleteItem(id) {
  if (!confirm("Delete this item?")) return;
  try {
    const res = await fetch(`${API_BASE}/api/items/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showBanner("Item deleted.");
    loadItems();
  } catch (err) {
    showBanner(err.message, "error");
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dt) {
  if (!dt) return "";
  return new Date(dt).toLocaleString();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadItems();
