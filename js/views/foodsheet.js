// Food sheet — tap a staple, it lands on the day's calorie/protein totals.
// Stays open for multi-add, keeps a running summary, and can undo taps.

import { el } from '../ui.js';
import { listFoods, addFood, logFood, unlogFood, FOOD_IDEAS } from '../foods.js';

export function openFoodSheet(iso, { onClose } = {}) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const session = []; // [{ name, applied }] for undo, newest last

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const search = el('input', { type: 'text', placeholder: 'Search your foods…', 'aria-label': 'Search foods' });
  const listEl = el('div', { class: 'pick-list food-list' });
  const footer = el('div', { class: 'food-footer' });

  const renderFooter = () => {
    footer.replaceChildren();
    if (session.length === 0) {
      footer.append(el('span', { class: 'rp-dim' }, 'Tap a food to add a serving.'));
      return;
    }
    const kcal = session.reduce((a, s) => a + s.applied.kcal, 0);
    const pro = session.reduce((a, s) => a + s.applied.protein, 0);
    footer.append(
      el('span', { class: 'food-sum' },
        el('b', {}, String(session.length)), ` added · +${Math.round(kcal).toLocaleString()} kcal · +${Math.round(pro * 10) / 10} g`),
      el('button', {
        class: 'btn sr-goalbtn',
        onclick: () => {
          const last = session.pop();
          if (last) unlogFood(iso, last.applied);
          renderFooter();
        },
      }, 'Undo'),
    );
  };

  // inline new-food form (collapsed behind a row)
  let showNew = false;
  const newName = el('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Food name' });
  const newKcal = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'kcal', 'aria-label': 'Food kcal' });
  const newPro = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'protein g', 'aria-label': 'Food protein' });

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    listEl.replaceChildren();

    // new-food entry point
    listEl.append(el('button', {
      class: 'pick-row pick-new',
      onclick: () => { showNew = !showNew; renderList(); if (showNew) newName.focus(); },
    }, showNew ? '– Cancel new food' : '＋ New food'));
    if (showNew) {
      listEl.append(el('div', { class: 'food-newform' },
        newName, newKcal, newPro,
        el('button', {
          class: 'btn primary sr-goalbtn',
          onclick: () => {
            const name = newName.value.trim();
            const kcal = parseFloat(newKcal.value);
            const protein = parseFloat(newPro.value);
            if (!name || !Number.isFinite(kcal)) { alert('A food needs a name and calories.'); return; }
            addFood({ name, kcal, protein: Number.isFinite(protein) ? protein : null });
            newName.value = ''; newKcal.value = ''; newPro.value = '';
            showNew = false;
            renderList();
          },
        }, 'Add'),
      ));
    }

    const foods = listFoods().filter((f) => !q || f.name.toLowerCase().includes(q));
    for (const f of foods) {
      const row = el('button', { class: 'pick-row food-row' },
        el('span', { class: 'food-name' }, f.name),
        el('span', { class: 'pick-hint' },
          `${f.kcal != null ? f.kcal.toLocaleString() + ' kcal' : ''}${f.protein != null ? ` · ${f.protein} g` : ''}`),
      );
      row.addEventListener('click', () => {
        const applied = logFood(iso, f);
        session.push({ name: f.name, applied });
        row.classList.remove('food-flash');
        void row.offsetWidth; // restart the flash animation
        row.classList.add('food-flash');
        renderFooter();
      });
      listEl.append(row);
    }
    if (foods.length === 0 && !q) {
      listEl.append(el('div', { class: 'empty-state' }, 'No foods yet — add your staples above, or grab ideas below.'));
    }

    // curated ideas (only ones not already in the library, filtered by search)
    const have = new Set(listFoods().map((f) => f.name.toLowerCase()));
    const ideas = FOOD_IDEAS.filter((i) => !have.has(i.name.toLowerCase()))
      .filter((i) => !q || i.name.toLowerCase().includes(q));
    if (ideas.length > 0) {
      listEl.append(el('div', { class: 'pick-head' }, 'Ideas — tap ＋ to save (typical values, adjust to your brands)'));
      for (const i of ideas) {
        listEl.append(el('div', { class: 'pick-row food-idea' },
          el('span', { class: 'food-name' }, i.name),
          el('span', { class: 'pick-hint' }, `${i.kcal.toLocaleString()} kcal · ${i.protein} g`),
          el('button', {
            class: 'icon-btn', 'aria-label': `Save ${i.name} to library`,
            onclick: () => { addFood(i); renderList(); },
          }, '＋'),
        ));
      }
    }
  };
  search.addEventListener('input', renderList);
  renderList();
  renderFooter();

  backdrop.append(el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Log food' },
    el('div', { class: 'food-head' },
      el('h2', {}, 'Log food'),
      el('button', { class: 'btn primary', onclick: close }, 'Done'),
    ),
    el('div', { class: 'field' }, search),
    listEl,
    footer,
  ));
  document.body.append(backdrop);
}
