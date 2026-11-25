(() => {
  'use strict';

  /**
   * Industrial & synthetic lubricant catalog for tryoil.
   * All filtering and detail rendering happen strictly in-memory.
   */
  const PRODUCTS = [
    {
      id: 'try-syn-5w40',
      name: 'Tryoil SynthForce PAO 5W-40',
      category: 'synthetic',
      saeIso: 'SAE 5W-40',
      viscosityIndex: 174,
      flashPointC: 238,
      pricePerLiterIDR: 148000,
      summary: 'Full-synthetic PAO engine & compressor oil engineered for high thermal stability and extended drain intervals.',
      specs: {
        baseStock: '100% PAO + Ester',
        kinematicViscosity40C: '84.6 cSt',
        kinematicViscosity100C: '14.2 cSt',
        pourPointC: '-42 °C',
        standards: 'API SP, ACEA A3/B4, MB 229.5',
        packaging: '20L Pail / 208L Drum',
      },
    },
    {
      id: 'try-syn-gear-220',
      name: 'Tryoil GearMax Synthetic 220',
      category: 'synthetic',
      saeIso: 'ISO VG 220',
      viscosityIndex: 162,
      flashPointC: 254,
      pricePerLiterIDR: 172000,
      summary: 'Extreme-pressure synthetic industrial gear oil for heavy-load helical, bevel, and planetary gearboxes.',
      specs: {
        baseStock: 'Polyalphaolefin (PAO)',
        kinematicViscosity40C: '220.0 cSt',
        kinematicViscosity100C: '26.4 cSt',
        pourPointC: '-36 °C',
        standards: 'DIN 51517-3 CLP, AGMA 9005-F16, US Steel 224',
        packaging: '20L Pail / 208L Drum',
      },
    },
    {
      id: 'try-syn-comp-46',
      name: 'Tryoil AeroComp Synth 46',
      category: 'synthetic',
      saeIso: 'ISO VG 46',
      viscosityIndex: 148,
      flashPointC: 246,
      pricePerLiterIDR: 159000,
      summary: 'Low-varnish synthetic rotary screw and vane air compressor oil rated up to 8,000 operating hours.',
      specs: {
        baseStock: 'Synthetic Diester / PAO Blend',
        kinematicViscosity40C: '46.2 cSt',
        kinematicViscosity100C: '7.8 cSt',
        pourPointC: '-45 °C',
        standards: 'DIN 51506 VDL, ISO 6743-3 DAJ',
        packaging: '20L Pail / 208L Drum',
      },
    },
    {
      id: 'try-hyd-aw-46',
      name: 'Tryoil HydroShield AW 46',
      category: 'hydraulic',
      saeIso: 'ISO VG 46',
      viscosityIndex: 108,
      flashPointC: 224,
      pricePerLiterIDR: 68000,
      summary: 'Anti-wear mineral hydraulic fluid with rapid air release and zinc-stabilized pump protection.',
      specs: {
        baseStock: 'Hydrocracked Group II',
        kinematicViscosity40C: '46.0 cSt',
        kinematicViscosity100C: '6.9 cSt',
        pourPointC: '-27 °C',
        standards: 'DIN 51524-2 HLP, Parker Denison HF-0, Eaton M-2950-S',
        packaging: '20L Pail / 208L Drum / 1000L IBC',
      },
    },
    {
      id: 'try-hyd-hvi-68',
      name: 'Tryoil HydroFlex HVI 68',
      category: 'hydraulic',
      saeIso: 'ISO VG 68',
      viscosityIndex: 152,
      flashPointC: 230,
      pricePerLiterIDR: 84000,
      summary: 'High-viscosity-index hydraulic oil for excavators, cranes, and outdoor equipment under wide temperature swings.',
      specs: {
        baseStock: 'Group II+ Shear-Stable VII',
        kinematicViscosity40C: '68.4 cSt',
        kinematicViscosity100C: '11.1 cSt',
        pourPointC: '-33 °C',
        standards: 'DIN 51524-3 HVLP, ISO 11158 HV, Bosch Rexroth RE 90220',
        packaging: '20L Pail / 208L Drum',
      },
    },
    {
      id: 'try-hyd-zincfree-32',
      name: 'Tryoil PureFlow Ashless 32',
      category: 'hydraulic',
      saeIso: 'ISO VG 32',
      viscosityIndex: 114,
      flashPointC: 218,
      pricePerLiterIDR: 92000,
      summary: 'Zinc-free, ashless precision hydraulic fluid designed for CNC servo valves and environmentally sensitive sites.',
      specs: {
        baseStock: 'Hydrotreated Group II/III',
        kinematicViscosity40C: '32.1 cSt',
        kinematicViscosity100C: '5.5 cSt',
        pourPointC: '-30 °C',
        standards: 'DIN 51524-2 HLP, Cincinnati P-68, ISO 15380 HEPR',
        packaging: '20L Pail / 208L Drum',
      },
    },
    {
      id: 'try-mar-tpeo-40',
      name: 'Tryoil MarineGuard TPEO 4040',
      category: 'marine',
      saeIso: 'SAE 40 (TBN 40)',
      viscosityIndex: 102,
      flashPointC: 242,
      pricePerLiterIDR: 96000,
      summary: 'High-alkalinity trunk piston engine oil formulated for medium-speed marine diesels running residual fuels.',
      specs: {
        baseStock: 'Solvent-Refined Heavy Paraffinic',
        kinematicViscosity40C: '138.0 cSt',
        kinematicViscosity100C: '14.3 cSt',
        pourPointC: '-18 °C',
        standards: 'API CF, MAN Energy Solutions, Wärtsilä Medium Speed',
        packaging: '208L Drum / Bulk Marine',
      },
    },
    {
      id: 'try-mar-cyl-5070',
      name: 'Tryoil SeaPulse Cylinder 5070',
      category: 'marine',
      saeIso: 'SAE 50 (TBN 70)',
      viscosityIndex: 99,
      flashPointC: 256,
      pricePerLiterIDR: 112000,
      summary: 'Two-stroke crosshead marine cylinder oil providing acid neutralization and ring-pack cleanliness.',
      specs: {
        baseStock: 'High-VI Bright Stock Blend',
        kinematicViscosity40C: '215.0 cSt',
        kinematicViscosity100C: '19.2 cSt',
        pourPointC: '-15 °C',
        standards: 'MAN B&W Category II, WinGD Approved',
        packaging: '208L Drum / 1000L IBC',
      },
    },
  ];

  const CATEGORY_LABELS = {
    synthetic: 'Synthetic',
    hydraulic: 'Hydraulic',
    marine: 'Marine',
  };

  const SPEC_LABELS = {
    baseStock: 'Base Stock',
    kinematicViscosity40C: 'Viscosity @ 40 °C',
    kinematicViscosity100C: 'Viscosity @ 100 °C',
    pourPointC: 'Pour Point',
    standards: 'Approvals & Standards',
    packaging: 'Packaging',
  };

  const currencyFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });

  function formatPriceIDR(value) {
    return `${currencyFormatter.format(value)} / L`;
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (text !== undefined && text !== null) {
      el.textContent = String(text);
    }
    return el;
  }

  function initCatalog() {
    const catalogGrid = document.getElementById('catalogGrid');
    const searchInput = document.getElementById('catalogSearch');
    const filterButtons = Array.from(document.querySelectorAll('.filter-btn[data-filter]'));
    const detailModal = document.getElementById('detailModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const closeModalBtn = document.getElementById('closeModalBtn');

    if (!catalogGrid) {
      return;
    }

    const activeBtn = filterButtons.find((btn) => btn.classList.contains('is-active'));
    let activeFilter = activeBtn ? activeBtn.dataset.filter || 'all' : 'all';
    let searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
    let lastFocusedElement = null;

    function matchesFilter(product) {
      const categoryMatch = activeFilter === 'all' || product.category === activeFilter;
      if (!categoryMatch) {
        return false;
      }
      if (!searchQuery) {
        return true;
      }

      const specValues = product.specs ? Object.values(product.specs).join(' ') : '';
      const haystack = [
        product.id,
        product.name,
        product.category,
        CATEGORY_LABELS[product.category] || '',
        product.saeIso,
        product.summary,
        String(product.viscosityIndex),
        String(product.flashPointC),
        specValues,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(searchQuery);
    }

    function openDetailModal(product) {
      if (!detailModal || !modalTitle || !modalBody) {
        return;
      }

      lastFocusedElement = document.activeElement;
      modalTitle.textContent = product.name;
      modalBody.replaceChildren();

      const metaRow = createEl('div', 'modal-meta');
      metaRow.appendChild(
        createEl('span', `badge badge-${product.category}`, CATEGORY_LABELS[product.category] || product.category)
      );
      metaRow.appendChild(createEl('span', 'modal-grade', product.saeIso));
      metaRow.appendChild(createEl('span', 'modal-price', formatPriceIDR(product.pricePerLiterIDR)));

      const summaryEl = createEl('p', 'modal-summary', product.summary);

      const specList = createEl('dl', 'spec-list');
      const coreSpecs = [
        ['Grade / ISO', product.saeIso],
        ['Viscosity Index', String(product.viscosityIndex)],
        ['Flash Point (COC)', `${product.flashPointC} °C`],
        ['Harga Referensi', formatPriceIDR(product.pricePerLiterIDR)],
      ];

      coreSpecs.forEach(([label, value]) => {
        const item = createEl('div', 'spec-row');
        item.appendChild(createEl('dt', 'spec-term', label));
        item.appendChild(createEl('dd', 'spec-value', value));
        specList.appendChild(item);
      });

      if (product.specs && typeof product.specs === 'object') {
        Object.entries(product.specs).forEach(([key, value]) => {
          const item = createEl('div', 'spec-row');
          item.appendChild(createEl('dt', 'spec-term', SPEC_LABELS[key] || key));
          item.appendChild(createEl('dd', 'spec-value', value));
          specList.appendChild(item);
        });
      }

      modalBody.appendChild(metaRow);
      modalBody.appendChild(summaryEl);
      modalBody.appendChild(specList);

      detailModal.hidden = false;
      detailModal.setAttribute('aria-hidden', 'false');

      if (closeModalBtn) {
        closeModalBtn.focus();
      }
    }

    function closeDetailModal() {
      if (!detailModal || detailModal.hidden) {
        return;
      }

      detailModal.hidden = true;
      detailModal.setAttribute('aria-hidden', 'true');

      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
      lastFocusedElement = null;
    }

    function createProductCard(product) {
      const card = createEl('article', 'catalog-card');
      card.dataset.category = product.category;
      card.dataset.id = product.id;

      const header = createEl('div', 'catalog-card-header');
      const badge = createEl(
        'span',
        `badge badge-${product.category}`,
        CATEGORY_LABELS[product.category] || product.category
      );
      const grade = createEl('span', 'catalog-grade', product.saeIso);
      header.appendChild(badge);
      header.appendChild(grade);

      const title = createEl('h3', 'catalog-card-title', product.name);
      const summary = createEl('p', 'catalog-card-summary', product.summary);

      const metrics = createEl('dl', 'catalog-metrics');
      const metricEntries = [
        ['VI', String(product.viscosityIndex)],
        ['Flash Point', `${product.flashPointC} °C`],
      ];
      metricEntries.forEach(([label, val]) => {
        const row = createEl('div', 'metric-item');
        row.appendChild(createEl('dt', 'metric-label', label));
        row.appendChild(createEl('dd', 'metric-value', val));
        metrics.appendChild(row);
      });

      const footer = createEl('div', 'catalog-card-footer');
      const price = createEl('strong', 'catalog-price', formatPriceIDR(product.pricePerLiterIDR));
      const detailBtn = createEl('button', 'btn btn-detail', 'Detail Spek');
      detailBtn.type = 'button';
      detailBtn.addEventListener('click', () => openDetailModal(product));

      footer.appendChild(price);
      footer.appendChild(detailBtn);

      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(summary);
      card.appendChild(metrics);
      card.appendChild(footer);

      return card;
    }

    function renderCatalog() {
      const filtered = PRODUCTS.filter(matchesFilter);
      catalogGrid.replaceChildren();

      if (filtered.length === 0) {
        const emptyState = createEl('div', 'catalog-empty');
        emptyState.setAttribute('role', 'status');
        emptyState.appendChild(createEl('h3', 'catalog-empty-title', 'Produk tidak ditemukan'));
        emptyState.appendChild(
          createEl(
            'p',
            'catalog-empty-text',
            'Tidak ada pelumas yang cocok dengan filter atau kata kunci pencarian saat ini.'
          )
        );
        catalogGrid.appendChild(emptyState);
        return;
      }

      const fragment = document.createDocumentFragment();
      filtered.forEach((product) => {
        fragment.appendChild(createProductCard(product));
      });
      catalogGrid.appendChild(fragment);
    }

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextFilter = button.dataset.filter || 'all';
        activeFilter = nextFilter;

        filterButtons.forEach((btn) => {
          const isCurrent = btn === button;
          btn.classList.toggle('is-active', isCurrent);
          btn.setAttribute('aria-pressed', String(isCurrent));
        });

        renderCatalog();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        searchQuery = event.target.value.trim().toLowerCase();
        renderCatalog();
      });
    }

    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', closeDetailModal);
    }

    if (detailModal) {
      detailModal.addEventListener('click', (event) => {
        if (
          event.target === detailModal ||
          event.target.classList.contains('modal-backdrop') ||
          event.target.hasAttribute('data-close-modal')
        ) {
          closeDetailModal();
        }
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && detailModal && !detailModal.hidden) {
        closeDetailModal();
      }
    });

    renderCatalog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCatalog);
  } else {
    initCatalog();
  }
})();
