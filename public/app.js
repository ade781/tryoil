(function () {
  'use strict';

  /** @type {Array<Object>} */
  let products = [];
  let activeCategory = 'all';
  let editingProductId = null;
  let toastTimer = null;

  const rupFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });

  const numberFormatter = new Intl.NumberFormat('id-ID');

  const els = {
    dbStatusBadge: document.getElementById('dbStatusBadge'),
    searchInput: document.getElementById('searchInput'),
    categoryFilter: document.getElementById('categoryFilter'),
    addProductBtn: document.getElementById('addProductBtn'),
    productList: document.getElementById('productList'),
    kpiTotalProducts: document.getElementById('kpiTotalProducts'),
    kpiTotalStock: document.getElementById('kpiTotalStock'),
    kpiInventoryValue: document.getElementById('kpiInventoryValue'),
    productModal: document.getElementById('productModal'),
    modalTitle: document.getElementById('modalTitle'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelModalBtn: document.getElementById('cancelModalBtn'),
    productForm: document.getElementById('productForm'),
    saveBtn: document.getElementById('saveBtn'),
    toast: document.getElementById('toast'),
  };

  function getField(id, name) {
    return (
      document.getElementById(id) ||
      (els.productForm && els.productForm.elements ? els.productForm.elements[name] : null)
    );
  }

  function formatRupiah(value) {
    const num = Number(value);
    return rupFormatter.format(Number.isFinite(num) ? num : 0);
  }

  function showToast(message, type) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.remove('hidden', 'toast-success', 'toast-error', 'is-error', 'is-success');
    els.toast.classList.add('show', 'is-visible');
    if (type === 'error') {
      els.toast.classList.add('toast-error', 'is-error');
    } else {
      els.toast.classList.add('toast-success', 'is-success');
    }
    els.toast.hidden = false;

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('show', 'is-visible');
      els.toast.classList.add('hidden');
      els.toast.hidden = true;
    }, 3000);
  }

  function updateKpis(list) {
    const items = Array.isArray(list) ? list : [];
    let totalStock = 0;
    let totalValue = 0;

    for (let i = 0; i < items.length; i += 1) {
      const price = Number(items[i].price) || 0;
      const stock = Number(items[i].stock) || 0;
      totalStock += stock;
      totalValue += price * stock;
    }

    if (els.kpiTotalProducts) {
      els.kpiTotalProducts.textContent = numberFormatter.format(items.length);
    }
    if (els.kpiTotalStock) {
      els.kpiTotalStock.textContent = numberFormatter.format(totalStock);
    }
    if (els.kpiInventoryValue) {
      els.kpiInventoryValue.textContent = formatRupiah(totalValue);
    }
  }

  function getFilteredProducts() {
    const query = els.searchInput ? els.searchInput.value.trim().toLowerCase() : '';
    const selectedCategory = els.categoryFilter
      ? els.categoryFilter.value.trim().toLowerCase()
      : activeCategory.toLowerCase();

    return products.filter(function (item) {
      if (selectedCategory && selectedCategory !== 'all' && selectedCategory !== 'semua') {
        const itemCategory = String(item.category || '').toLowerCase();
        if (itemCategory !== selectedCategory) return false;
      }

      if (!query) return true;

      const haystack = [
        item.name,
        item.brand,
        item.category,
        item.description,
      ]
        .map(function (v) {
          return String(v || '').toLowerCase();
        })
        .join(' ');

      return haystack.indexOf(query) !== -1;
    });
  }

  function createStockBadge(stockValue) {
    const stock = Number(stockValue) || 0;
    const badge = document.createElement('span');
    badge.className = 'stock-badge';

    if (stock <= 0) {
      badge.classList.add('stock-empty', 'is-empty');
      badge.textContent = 'Stok Habis (0)';
    } else if (stock <= 5) {
      badge.classList.add('stock-low', 'is-low');
      badge.textContent = 'Stok Menipis (' + numberFormatter.format(stock) + ')';
    } else {
      badge.classList.add('stock-ok', 'is-ok');
      badge.textContent = 'Stok: ' + numberFormatter.format(stock);
    }

    return badge;
  }

  function renderProducts(list) {
    if (!els.productList) return;
    els.productList.textContent = '';

    if (!list.length) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-state';

      const emptyTitle = document.createElement('p');
      emptyTitle.className = 'empty-title';
      emptyTitle.textContent = products.length
        ? 'Tidak ada produk yang cocok dengan pencarian.'
        : 'Belum ada produk alat pancing.';

      emptyBox.appendChild(emptyTitle);
      els.productList.appendChild(emptyBox);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      const card = document.createElement('article');
      card.className = 'product-card';
      card.dataset.id = String(item.id != null ? item.id : '');

      const header = document.createElement('div');
      header.className = 'product-card-header';

      const metaRow = document.createElement('div');
      metaRow.className = 'product-meta';

      const categorySpan = document.createElement('span');
      categorySpan.className = 'product-category';
      categorySpan.textContent = item.category || 'Lainnya';

      const brandSpan = document.createElement('span');
      brandSpan.className = 'product-brand';
      brandSpan.textContent = item.brand || '-';

      metaRow.appendChild(categorySpan);
      metaRow.appendChild(brandSpan);

      const stockBadge = createStockBadge(item.stock);

      header.appendChild(metaRow);
      header.appendChild(stockBadge);

      const title = document.createElement('h3');
      title.className = 'product-name';
      title.textContent = item.name || 'Produk Tanpa Nama';

      const desc = document.createElement('p');
      desc.className = 'product-description';
      desc.textContent = item.description || 'Tidak ada deskripsi.';

      const footer = document.createElement('div');
      footer.className = 'product-card-footer';

      const priceEl = document.createElement('div');
      priceEl.className = 'product-price';
      priceEl.textContent = formatRupiah(item.price);

      const actions = document.createElement('div');
      actions.className = 'product-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () {
        openModal('edit', item);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger btn-delete';
      deleteBtn.textContent = 'Hapus';
      deleteBtn.addEventListener('click', function () {
        handleDelete(item);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      footer.appendChild(priceEl);
      footer.appendChild(actions);

      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(footer);

      fragment.appendChild(card);
    }

    els.productList.appendChild(fragment);
  }

  function applyFilterAndRender() {
    const filtered = getFilteredProducts();
    renderProducts(filtered);
  }

  function openModal(mode, product) {
    if (!els.productModal || !els.productForm) return;

    const idField = getField('productId', 'id');
    const nameField = getField('productName', 'name');
    const categoryField = getField('productCategory', 'category');
    const brandField = getField('productBrand', 'brand');
    const priceField = getField('productPrice', 'price');
    const stockField = getField('productStock', 'stock');
    const descField = getField('productDescription', 'description');

    els.productForm.reset();

    if (mode === 'edit' && product) {
      editingProductId = product.id;
      if (els.modalTitle) els.modalTitle.textContent = 'Edit Produk';
      if (idField) idField.value = String(product.id != null ? product.id : '');
      if (nameField) nameField.value = product.name || '';
      if (categoryField) categoryField.value = product.category || '';
      if (brandField) brandField.value = product.brand || '';
      if (priceField) priceField.value = product.price != null ? String(product.price) : '';
      if (stockField) stockField.value = product.stock != null ? String(product.stock) : '';
      if (descField) descField.value = product.description || '';
    } else {
      editingProductId = null;
      if (els.modalTitle) els.modalTitle.textContent = 'Tambah Produk';
      if (idField) idField.value = '';
    }

    els.productModal.hidden = false;
    els.productModal.classList.remove('hidden');
    els.productModal.classList.add('open', 'is-open');
    els.productModal.setAttribute('aria-hidden', 'false');

    if (nameField) {
      nameField.focus();
    }
  }

  function closeModal() {
    if (!els.productModal) return;
    els.productModal.hidden = true;
    els.productModal.classList.add('hidden');
    els.productModal.classList.remove('open', 'is-open');
    els.productModal.setAttribute('aria-hidden', 'true');
    editingProductId = null;
  }

  async function checkHealth() {
    if (!els.dbStatusBadge) return;
    try {
      const res = await fetch('/api/health');
      const data = await res.json().catch(function () {
        return {};
      });
      const isHealthy =
        res.ok &&
        (data.ok === true ||
          data.status === 'ok' ||
          data.healthy === true ||
          data.db === 'connected' ||
          data.database === 'connected');

      els.dbStatusBadge.classList.remove('status-online', 'status-offline', 'is-online', 'is-offline');
      if (isHealthy) {
        els.dbStatusBadge.classList.add('status-online', 'is-online');
        els.dbStatusBadge.textContent = 'DB Terhubung';
      } else {
        els.dbStatusBadge.classList.add('status-offline', 'is-offline');
        els.dbStatusBadge.textContent = 'DB Bermasalah';
      }
    } catch (_err) {
      els.dbStatusBadge.classList.remove('status-online', 'is-online');
      els.dbStatusBadge.classList.add('status-offline', 'is-offline');
      els.dbStatusBadge.textContent = 'DB Terputus';
    }
  }

  async function loadProducts() {
    try {
      const res = await fetch('/api/products');
      if (!res.ok) {
        throw new Error('Gagal memuat daftar produk (HTTP ' + res.status + ')');
      }
      const payload = await res.json();
      if (Array.isArray(payload)) {
        products = payload;
      } else if (payload && Array.isArray(payload.data)) {
        products = payload.data;
      } else if (payload && Array.isArray(payload.products)) {
        products = payload.products;
      } else {
        products = [];
      }

      updateKpis(products);
      applyFilterAndRender();
    } catch (err) {
      showToast(err.message || 'Gagal memuat data produk.', 'error');
    }
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    if (!els.productForm) return;

    const nameField = getField('productName', 'name');
    const categoryField = getField('productCategory', 'category');
    const brandField = getField('productBrand', 'brand');
    const priceField = getField('productPrice', 'price');
    const stockField = getField('productStock', 'stock');
    const descField = getField('productDescription', 'description');

    const payload = {
      name: nameField ? nameField.value.trim() : '',
      category: categoryField ? categoryField.value.trim() : '',
      brand: brandField ? brandField.value.trim() : '',
      price: priceField ? Number(priceField.value) : 0,
      stock: stockField ? Number(stockField.value) : 0,
      description: descField ? descField.value.trim() : '',
    };

    if (!payload.name) {
      showToast('Nama produk wajib diisi.', 'error');
      return;
    }

    const isEdit = editingProductId !== null && editingProductId !== '';
    const url = isEdit
      ? '/api/products/' + encodeURIComponent(editingProductId)
      : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    if (els.saveBtn) {
      els.saveBtn.disabled = true;
    }

    try {
      const res = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(function () {
        return {};
      });

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Gagal menyimpan produk.');
      }

      closeModal();
      await loadProducts();
      showToast(isEdit ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.', 'success');
    } catch (err) {
      showToast(err.message || 'Terjadi kesalahan saat menyimpan.', 'error');
    } finally {
      if (els.saveBtn) {
        els.saveBtn.disabled = false;
      }
    }
  }

  async function handleDelete(product) {
    if (!product || product.id == null) return;
    const confirmed = window.confirm(
      'Hapus produk "' + (product.name || 'ini') + '"?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/products/' + encodeURIComponent(product.id), {
        method: 'DELETE',
      });
      const data = await res.json().catch(function () {
        return {};
      });

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Gagal menghapus produk.');
      }

      await loadProducts();
      showToast('Produk berhasil dihapus.', 'success');
    } catch (err) {
      showToast(err.message || 'Terjadi kesalahan saat menghapus.', 'error');
    }
  }

  function bindEvents() {
    if (els.searchInput) {
      els.searchInput.addEventListener('input', applyFilterAndRender);
    }

    if (els.categoryFilter) {
      els.categoryFilter.addEventListener('change', applyFilterAndRender);
    }

    const filterBtns = document.querySelectorAll('.filter-btn[data-category]');
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeCategory = btn.getAttribute('data-category') || 'all';
        filterBtns.forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        applyFilterAndRender();
      });
    });

    if (els.addProductBtn) {
      els.addProductBtn.addEventListener('click', function () {
        openModal('add');
      });
    }

    if (els.closeModalBtn) {
      els.closeModalBtn.addEventListener('click', closeModal);
    }

    if (els.cancelModalBtn) {
      els.cancelModalBtn.addEventListener('click', closeModal);
    }

    if (els.productModal) {
      els.productModal.addEventListener('click', function (event) {
        if (event.target === els.productModal) {
          closeModal();
        }
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && els.productModal && !els.productModal.hidden) {
        closeModal();
      }
    });

    if (els.productForm) {
      els.productForm.addEventListener('submit', handleFormSubmit);
    }
  }

  function init() {
    bindEvents();
    checkHealth();
    loadProducts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
