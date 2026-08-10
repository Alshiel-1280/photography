'use strict';

const categoryLabels = {
    portrait: 'ポートレート',
    profile: 'プロフィール',
    cosplay: 'コスプレ',
    event: 'イベント',
    animal: '動物',
    landscape: '風景',
    portfolio: '未分類'
};

const state = {
    photos: [],
    services: [],
    pending: [],
    articles: [],
    selected: null,
    selectedArticle: null,
    mode: 'photos',
    toastTimer: null,
    detailImageRequest: 0,
    imageObserver: null
};

const elements = {
    photosModeButton: document.getElementById('photos-mode-button'),
    articlesModeButton: document.getElementById('articles-mode-button'),
    photoWorkspace: document.getElementById('photo-workspace'),
    articleWorkspace: document.getElementById('article-workspace'),
    addButton: document.getElementById('add-button'),
    newArticleButton: document.getElementById('new-article-button'),
    catalog: document.querySelector('.catalog'),
    fileInput: document.getElementById('file-input'),
    searchInput: document.getElementById('search-input'),
    categoryFilter: document.getElementById('category-filter'),
    referenceFilter: document.getElementById('reference-filter'),
    needsDescriptionFilter: document.getElementById('needs-description-filter'),
    sortSelect: document.getElementById('sort-select'),
    photoGrid: document.getElementById('photo-grid'),
    resultCount: document.getElementById('result-count'),
    emptyState: document.getElementById('empty-state'),
    totalCount: document.getElementById('total-count'),
    describedCount: document.getElementById('described-count'),
    referencedCount: document.getElementById('referenced-count'),
    detailPanel: document.getElementById('detail-panel'),
    detailEmpty: document.getElementById('detail-empty'),
    detailForm: document.getElementById('detail-form'),
    detailImage: document.getElementById('detail-image'),
    detailFile: document.getElementById('detail-file'),
    detailTitleHeading: document.getElementById('detail-title-heading'),
    pendingBadge: document.getElementById('pending-badge'),
    closeDetail: document.getElementById('close-detail'),
    newFileNameField: document.getElementById('new-file-name-field'),
    outputName: document.getElementById('output-name'),
    photoTitle: document.getElementById('photo-title'),
    photoAlt: document.getElementById('photo-alt'),
    altCount: document.getElementById('alt-count'),
    photoCategory: document.getElementById('photo-category'),
    photoArea: document.getElementById('photo-area'),
    photoOrder: document.getElementById('photo-order'),
    photoFeatured: document.getElementById('photo-featured'),
    existingOptions: document.getElementById('existing-options'),
    referencesTitle: document.getElementById('references-title'),
    referenceCount: document.getElementById('reference-count'),
    referencesList: document.getElementById('references-list'),
    newServicesSection: document.getElementById('new-services-section'),
    serviceOptions: document.getElementById('service-options'),
    deleteButton: document.getElementById('delete-button'),
    deleteDialog: document.getElementById('delete-dialog'),
    deleteDialogDescription: document.getElementById('delete-dialog-description'),
    deleteCancelButton: document.getElementById('delete-cancel-button'),
    deleteConfirmButton: document.getElementById('delete-confirm-button'),
    cancelButton: document.getElementById('cancel-button'),
    saveButton: document.getElementById('save-button'),
    saveState: document.getElementById('save-state'),
    articleSearchInput: document.getElementById('article-search-input'),
    articleCount: document.getElementById('article-count'),
    articleList: document.getElementById('article-list'),
    articleEmpty: document.getElementById('article-empty'),
    articleForm: document.getElementById('article-form'),
    articleFile: document.getElementById('article-file'),
    articleFormHeading: document.getElementById('article-form-heading'),
    articleStatusBadge: document.getElementById('article-status-badge'),
    articleTitle: document.getElementById('article-title'),
    articleDescription: document.getElementById('article-description'),
    articleDescriptionCount: document.getElementById('article-description-count'),
    articleBody: document.getElementById('article-body'),
    articleSlug: document.getElementById('article-slug'),
    articleCategory: document.getElementById('article-category'),
    articleDate: document.getElementById('article-date'),
    articleUpdated: document.getElementById('article-updated'),
    articleService: document.getElementById('article-service'),
    articlePublished: document.getElementById('article-published'),
    articleHero: document.getElementById('article-hero'),
    articleHeroPreview: document.getElementById('article-hero-preview'),
    articleHeroAlt: document.getElementById('article-hero-alt'),
    articlePhotoSearchInput: document.getElementById('article-photo-search-input'),
    articlePhotoOptions: document.getElementById('article-photo-options'),
    articlePhotoCount: document.getElementById('article-photo-count'),
    deleteArticleButton: document.getElementById('delete-article-button'),
    cancelArticleButton: document.getElementById('cancel-article-button'),
    saveArticleButton: document.getElementById('save-article-button'),
    deleteArticleDialog: document.getElementById('delete-article-dialog'),
    deleteArticleDialogDescription: document.getElementById('delete-article-dialog-description'),
    deleteArticleCancelButton: document.getElementById('delete-article-cancel-button'),
    deleteArticleConfirmButton: document.getElementById('delete-article-confirm-button'),
    toast: document.getElementById('toast')
};

function isTemporaryDescription(photo) {
    return photo.alt.includes('ポートフォリオ作品「')
        || /^Z?\d[\w ._()-]*$/i.test(photo.title)
        || photo.title === photo.file.replace(/\.[^.]+$/, '');
}

function serviceReferences(photo) {
    return photo.references.filter((reference) => reference.kind === 'service' || reference.kind === 'hero');
}

function allItems() {
    return [
        ...state.photos.map((photo) => ({
            ...photo,
            itemType: photo.registered ? 'existing' : 'orphan',
            id: photo.file
        })),
        ...state.pending.map((pending) => ({ ...pending, itemType: 'pending' }))
    ];
}

function filteredItems() {
    const query = elements.searchInput.value.trim().toLocaleLowerCase('ja');
    const category = elements.categoryFilter.value;
    const reference = elements.referenceFilter.value;
    const needsDescription = elements.needsDescriptionFilter.checked;
    const sort = elements.sortSelect.value;

    const items = allItems().filter((item) => {
        const haystack = [item.title, item.alt, item.file, item.area]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('ja');
        if (query && !haystack.includes(query))
            return false;
        if (category && item.category !== category)
            return false;
        if (needsDescription && item.itemType === 'existing' && !isTemporaryDescription(item))
            return false;
        if (needsDescription && item.itemType === 'pending')
            return false;

        if (reference === 'pending')
            return item.itemType === 'pending';
        if (reference === 'orphan')
            return item.itemType === 'orphan';
        if (reference && item.itemType === 'pending')
            return false;
        if (reference && item.itemType === 'orphan')
            return false;
        if (reference === 'service')
            return item.references.some((itemReference) => itemReference.kind === 'service');
        if (reference === 'hero')
            return item.references.some((itemReference) => itemReference.kind === 'hero');
        if (reference === 'article')
            return item.references.some((itemReference) => itemReference.kind === 'article' || itemReference.kind === 'articleHero');
        if (reference === 'unreferenced')
            return serviceReferences(item).length === 0;
        return true;
    });

    items.sort((left, right) => {
        if (left.itemType !== right.itemType)
            return left.itemType === 'pending' ? -1 : 1;
        if (sort === 'title')
            return left.title.localeCompare(right.title, 'ja');
        if (sort === 'newest')
            return (right.order || Number.MAX_SAFE_INTEGER) - (left.order || Number.MAX_SAFE_INTEGER);
        return (left.order || Number.MAX_SAFE_INTEGER) - (right.order || Number.MAX_SAFE_INTEGER);
    });
    return items;
}

function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className)
        element.className = className;
    if (text !== undefined)
        element.textContent = text;
    return element;
}

function observeCatalogImage(image, source) {
    image.dataset.src = source;
    image.decoding = 'async';
    image.loading = 'lazy';
    image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
    image.addEventListener('error', () => {
        image.style.display = 'none';
        image.parentElement.dataset.failed = 'true';
    }, { once: true });

    if (state.imageObserver) {
        state.imageObserver.observe(image);
        return;
    }
    image.src = source;
}

function resetImageObserver() {
    if (state.imageObserver)
        state.imageObserver.disconnect();
    if (!('IntersectionObserver' in window)) {
        state.imageObserver = null;
        return;
    }
    state.imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting)
                return;
            const image = entry.target;
            image.src = image.dataset.src;
            observer.unobserve(image);
        });
    }, {
        root: elements.catalog,
        rootMargin: '180px 0px',
        threshold: 0.01
    });
}

function renderCatalog() {
    const items = filteredItems();
    resetImageObserver();
    elements.photoGrid.replaceChildren();
    elements.resultCount.textContent = `${items.length}件を表示`;
    elements.emptyState.hidden = items.length > 0;

    items.forEach((item) => {
        const card = makeElement('button', 'photo-card');
        card.type = 'button';
        card.dataset.id = item.id;
        card.dataset.type = item.itemType;
        card.setAttribute('aria-label', `${item.title || item.file}の詳細を開く`);
        if (state.selected && state.selected.id === item.id)
            card.classList.add('is-selected');

        const imageWrap = makeElement('div', 'photo-card-image');
        const imageSource = item.itemType === 'pending' ? item.previewUrl : item.thumbUrl;
        if (imageSource) {
            const image = document.createElement('img');
            image.alt = item.alt || item.title || item.file;
            observeCatalogImage(image, imageSource);
            imageWrap.append(image);
        } else {
            imageWrap.classList.add('is-staging');
        }

        if (item.itemType === 'pending') {
            imageWrap.append(makeElement('span', 'card-badge pending', item.staging ? 'thumbs生成中' : '追加待ち'));
        } else if (item.itemType === 'orphan') {
            imageWrap.append(makeElement('span', 'card-badge pending', '未登録'));
        } else if (serviceReferences(item).length > 0) {
            imageWrap.append(makeElement('span', 'card-badge', `使用 ${serviceReferences(item).length}`));
        }

        const body = makeElement('div', 'photo-card-body');
        body.append(makeElement('strong', '', item.title || 'タイトル未入力'));
        body.append(makeElement('p', '', item.file));
        const meta = makeElement('div', 'card-meta');
        meta.append(makeElement('span', 'category-chip', categoryLabels[item.category] || item.category));
        meta.append(makeElement(
            'span',
            'reference-number',
            item.itemType === 'pending'
                ? item.staging ? '処理中' : '未保存'
                : item.itemType === 'orphan' ? '登録待ち' : `${item.references.length}か所`
        ));
        body.append(meta);
        card.append(imageWrap, body);
        card.addEventListener('click', () => openItem(item));
        elements.photoGrid.append(card);
    });
}

function updateSelectedCard() {
    elements.photoGrid.querySelectorAll('.photo-card.is-selected').forEach((card) => {
        card.classList.remove('is-selected');
    });
    if (!state.selected)
        return;
    const selectedCard = Array.from(elements.photoGrid.querySelectorAll('.photo-card'))
        .find((card) => card.dataset.id === state.selected.id);
    if (selectedCard)
        selectedCard.classList.add('is-selected');
}

function createReferenceItem(reference) {
    const item = makeElement('div', 'reference-item');
    const heading = makeElement('div', 'reference-item-heading');
    heading.append(makeElement('strong', '', reference.label));
    heading.append(makeElement('code', '', reference.source));
    item.append(heading);

    if (reference.editable) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = reference.alt;
        input.dataset.serviceKey = reference.serviceKey;
        input.setAttribute('aria-label', `${reference.label}のalt`);
        item.append(input);
    }
    return item;
}

function existingServiceKeys(item) {
    return new Set(
        item.references
            .filter((reference) => reference.kind === 'service')
            .map((reference) => reference.serviceKey)
    );
}

function renderServiceOptions(item) {
    elements.serviceOptions.replaceChildren();
    const currentServices = item.itemType === 'existing' ? existingServiceKeys(item) : new Set();
    const available = state.services.filter((service) => !currentServices.has(service.key));

    elements.newServicesSection.hidden = available.length === 0;
    available.forEach((service) => {
        const label = makeElement('label', 'service-option');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = service.key;
        label.append(input, makeElement('span', '', service.name));
        elements.serviceOptions.append(label);
    });
}

function openItem(item) {
    state.selected = { id: item.id, type: item.itemType };
    const imageRequest = ++state.detailImageRequest;
    elements.detailEmpty.hidden = true;
    elements.detailForm.hidden = false;
    elements.detailPanel.classList.add('is-open');
    elements.detailImage.decoding = 'async';
    const detailSource = item.itemType === 'pending' ? item.previewUrl : item.thumbUrl;
    if (detailSource)
        elements.detailImage.src = detailSource;
    else
        elements.detailImage.removeAttribute('src');
    elements.detailImage.alt = item.alt || item.title || item.file;
    elements.detailFile.textContent = item.file;
    elements.detailTitleHeading.textContent = item.itemType === 'pending'
        ? '新しい写真'
        : item.itemType === 'orphan'
            ? '未登録写真'
            : '写真の詳細';
    elements.pendingBadge.hidden = item.itemType === 'existing';
    elements.pendingBadge.textContent = item.itemType === 'orphan'
        ? '未登録'
        : item.staging ? 'thumbs生成中' : '追加待ち';
    elements.newFileNameField.hidden = item.itemType === 'existing';
    elements.existingOptions.hidden = item.itemType !== 'existing';
    elements.outputName.value = item.outputName || '';
    elements.photoTitle.value = item.title || '';
    elements.photoAlt.value = item.alt || '';
    elements.photoCategory.value = item.category || 'portfolio';
    elements.photoArea.value = item.area || '';
    elements.photoOrder.value = item.order || '';
    elements.photoFeatured.checked = Boolean(item.featured);
    elements.saveButton.textContent = item.itemType === 'pending'
        ? item.staging ? 'thumbs生成中' : '生成して保存'
        : item.itemType === 'orphan'
            ? '生成して登録'
            : '保存する';
    elements.saveButton.disabled = Boolean(item.staging);
    updateAltCount();

    const references = item.itemType === 'pending' || item.itemType === 'orphan' ? [] : item.references;
    const isRegistration = item.itemType === 'pending' || item.itemType === 'orphan';
    elements.referencesTitle.textContent = isRegistration ? '登録後の使用場所' : '現在の使用場所';
    elements.referenceCount.textContent = isRegistration ? 'トップ・サイトマップ' : `${references.length}件`;
    elements.referencesList.replaceChildren();

    if (isRegistration) {
        elements.referencesList.append(
            createReferenceItem({
                label: 'トップページの作品一覧',
                source: '_data/photos.yml',
                editable: false
            }),
            createReferenceItem({
                label: '画像サイトマップ',
                source: 'sitemap.xml',
                editable: false
            })
        );
    } else {
        references.forEach((reference) => elements.referencesList.append(createReferenceItem(reference)));
    }

    renderServiceOptions(item);
    updateSelectedCard();

    if (item.itemType !== 'pending' && item.fullUrl !== item.thumbUrl) {
        window.setTimeout(() => {
            const fullImage = new Image();
            fullImage.decoding = 'async';
            fullImage.onload = () => {
                if (state.detailImageRequest === imageRequest)
                    elements.detailImage.src = item.fullUrl;
            };
            fullImage.src = item.fullUrl;
        }, 0);
    }
}

function closeDetail() {
    state.detailImageRequest += 1;
    state.selected = null;
    elements.detailForm.hidden = true;
    elements.detailEmpty.hidden = false;
    elements.detailPanel.classList.remove('is-open');
    updateSelectedCard();
}

function requestDeleteSelected() {
    const item = selectedItem();
    if (!item)
        return;

    const description = item.itemType === 'pending'
        ? '追加待ちから取り除きます。元の写真ファイルは削除されません。'
        : 'fulls・thumbs・ポートフォリオ管理データから削除します。この操作は取り消せません。';
    elements.deleteDialogDescription.textContent = `「${item.title || item.file}」を${description}`;
    elements.deleteDialog.showModal();
}

async function deleteSelected() {
    const item = selectedItem();
    if (!item)
        return;
    elements.deleteDialog.close();
    elements.deleteButton.disabled = true;
    elements.saveButton.disabled = true;
    elements.saveState.textContent = '削除しています…';

    try {
        let catalogNeedsRender = false;
        if (item.itemType === 'pending') {
            item.cancelled = true;
            if (item.stageToken) {
                const response = await fetch(`/api/staging/${encodeURIComponent(item.stageToken)}`, {
                    method: 'DELETE'
                });
                if (!response.ok && response.status !== 404) {
                    const result = await response.json();
                    throw new Error(result.error || '追加待ち画像を削除できませんでした。');
                }
            }
            state.pending = state.pending.filter((pending) => pending.id !== item.id);
            catalogNeedsRender = true;
        } else {
            const response = await fetch(`/api/photos/${encodeURIComponent(item.file)}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error || '削除に失敗しました。');
            await loadCatalog();
        }
        closeDetail();
        if (catalogNeedsRender)
            renderCatalog();
        showToast('写真を削除しました。');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        elements.deleteButton.disabled = false;
        elements.saveButton.disabled = false;
        elements.saveState.textContent = '';
    }
}

function selectedItem() {
    if (!state.selected)
        return null;
    if (state.selected.type === 'pending')
        return state.pending.find((item) => item.id === state.selected.id);
    return state.photos.find((item) => item.file === state.selected.id);
}

function selectedServiceOptions() {
    return Array.from(elements.serviceOptions.querySelectorAll('input:checked')).map((input) => input.value);
}

function referenceAltValues() {
    const values = {};
    elements.referencesList.querySelectorAll('input[data-service-key]').forEach((input) => {
        values[input.dataset.serviceKey] = input.value.trim();
    });
    return values;
}

function formMetadata(item) {
    return {
        originalName: item.file,
        outputName: elements.outputName.value.trim(),
        title: elements.photoTitle.value.trim(),
        alt: elements.photoAlt.value.trim(),
        category: elements.photoCategory.value,
        area: elements.photoArea.value.trim(),
        order: Number(elements.photoOrder.value || item.order || 1),
        featured: elements.photoFeatured.checked,
        serviceKeys: selectedServiceOptions(),
        addServiceKeys: selectedServiceOptions(),
        referenceAlts: referenceAltValues()
    };
}

async function saveSelected(event) {
    event.preventDefault();
    const item = selectedItem();
    if (!item)
        return;
    if (item.staging) {
        showToast('thumbsの生成が完了するまでお待ちください。', true);
        return;
    }

    const metadata = formMetadata(item);
    if (!metadata.title || !metadata.alt) {
        showToast('タイトルとaltを入力してください。', true);
        return;
    }

    elements.saveButton.disabled = true;
    elements.cancelButton.disabled = true;
    elements.saveState.textContent = item.itemType === 'pending' ? '画像を生成しています…' : '保存しています…';

    try {
        let response;
        if (item.itemType === 'pending') {
            response = await fetch('/api/photos/import-staged', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stageToken: item.stageToken,
                    metadata
                })
            });
        } else if (!item.registered) {
            response = await fetch(`/api/photos/register/${encodeURIComponent(item.file)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metadata)
            });
        } else {
            response = await fetch(`/api/photos/${encodeURIComponent(item.file)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metadata)
            });
        }

        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || '保存に失敗しました。');

        if (item.itemType === 'pending') {
            state.pending = state.pending.filter((pending) => pending.id !== item.id);
        }
        await loadCatalog();
        closeDetail();
        showToast(item.itemType === 'pending' || !item.registered
            ? 'fulls、thumbs、管理データを保存しました。'
            : '写真情報を保存しました。');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        elements.saveButton.disabled = false;
        elements.cancelButton.disabled = false;
        elements.saveState.textContent = '';
    }
}

function titleFromFile(fileName) {
    return fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function discardStagedToken(token) {
    if (!token)
        return;
    await fetch(`/api/staging/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
}

async function stagePendingFile(file, item, autoOpen) {
    try {
        const response = await fetch(`/api/staging?${new URLSearchParams({ name: file.name })}`, {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file
        });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'thumbsを生成できませんでした。');
        if (item.cancelled || !state.pending.some((pending) => pending.id === item.id)) {
            await discardStagedToken(result.token);
            return;
        }

        item.stageToken = result.token;
        item.previewUrl = result.previewUrl;
        item.staging = false;
        renderCatalog();

        if (state.selected && state.selected.id === item.id) {
            elements.detailImage.src = item.previewUrl;
            elements.pendingBadge.textContent = '追加待ち';
            elements.saveButton.textContent = '生成して保存';
            elements.saveButton.disabled = false;
        } else if (autoOpen && !state.selected) {
            openItem(item);
        }
    } catch (error) {
        state.pending = state.pending.filter((pending) => pending.id !== item.id);
        if (state.selected && state.selected.id === item.id)
            closeDetail();
        renderCatalog();
        showToast(`${file.name}: ${error.message}`, true);
    }
}

function addPendingFiles(fileList) {
    const added = [];
    Array.from(fileList).forEach((file) => {
        if (!file.type.startsWith('image/') && !/\.(heic|tiff?|jpe?g|png|webp)$/i.test(file.name)) {
            showToast(`${file.name}は対応していない形式です。`, true);
            return;
        }
        const item = {
            id: `pending-${cryptoRandomId()}`,
            itemType: 'pending',
            file: file.name,
            previewUrl: '',
            stageToken: '',
            staging: true,
            cancelled: false,
            title: titleFromFile(file.name),
            alt: '',
            category: 'portfolio',
            area: '',
            featured: false,
            order: Number.MAX_SAFE_INTEGER,
            outputName: ''
        };
        state.pending.push(item);
        added.push(item);
        stagePendingFile(file, item, added.length === 1);
    });
    renderCatalog();
}

function cryptoRandomId() {
    if (window.crypto && window.crypto.randomUUID)
        return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function updateStats(stats) {
    elements.totalCount.textContent = stats.total + state.pending.length;
    elements.describedCount.textContent = stats.described;
    elements.referencedCount.textContent = stats.referenced;
}

async function loadCatalog() {
    const response = await fetch('/api/photos', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error || '写真一覧を読み込めませんでした。');
    state.photos = result.photos;
    state.services = result.services;
    updateStats(result.stats);
    renderCatalog();
}

function today() {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function switchMode(mode) {
    state.mode = mode;
    const photosActive = mode === 'photos';
    elements.photoWorkspace.hidden = !photosActive;
    elements.articleWorkspace.hidden = photosActive;
    elements.addButton.hidden = !photosActive;
    elements.newArticleButton.hidden = photosActive;
    elements.photosModeButton.classList.toggle('is-active', photosActive);
    elements.articlesModeButton.classList.toggle('is-active', !photosActive);
    elements.photosModeButton.setAttribute('aria-pressed', String(photosActive));
    elements.articlesModeButton.setAttribute('aria-pressed', String(!photosActive));
    elements.saveState.textContent = '';
}

function filteredArticles() {
    const query = elements.articleSearchInput.value.trim().toLocaleLowerCase('ja');
    if (!query)
        return state.articles;
    return state.articles.filter((article) => [article.title, article.category, article.description, article.body]
        .join(' ')
        .toLocaleLowerCase('ja')
        .includes(query));
}

function renderArticleList() {
    const articles = filteredArticles();
    elements.articleList.replaceChildren();
    elements.articleCount.textContent = `${articles.length}件`;

    if (articles.length === 0) {
        const empty = makeElement('p', 'article-list-empty', '記事がありません。');
        elements.articleList.append(empty);
        return;
    }

    articles.forEach((article) => {
        const button = makeElement('button', 'article-list-item');
        button.type = 'button';
        if (state.selectedArticle && !state.selectedArticle.isNew && state.selectedArticle.slug === article.slug)
            button.classList.add('is-selected');
        button.append(makeElement('strong', '', article.title));
        const meta = makeElement('div', 'article-list-item-meta');
        meta.append(makeElement('span', '', `${article.category} · ${article.date}`));
        meta.append(makeElement(
            'span',
            `article-list-item-status${article.published ? ' is-published' : ''}`,
            article.published ? '公開' : '下書き'
        ));
        button.append(meta);
        button.addEventListener('click', () => openArticle(article));
        elements.articleList.append(button);
    });
}

function renderArticleServices() {
    const currentValue = elements.articleService.value;
    elements.articleService.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '撮影依頼一覧';
    elements.articleService.append(empty);
    state.services.forEach((service) => {
        const option = document.createElement('option');
        option.value = service.key;
        option.textContent = service.name;
        elements.articleService.append(option);
    });
    elements.articleService.value = currentValue;
}

function articleSelectedPhotoFiles() {
    return new Set(Array.from(elements.articlePhotoOptions.querySelectorAll('input:checked')).map((input) => input.value));
}

function updateArticlePhotoCount() {
    elements.articlePhotoCount.textContent = `${articleSelectedPhotoFiles().size}枚`;
}

function renderArticlePhotoOptions(selectedFiles) {
    const selected = selectedFiles || articleSelectedPhotoFiles();
    const query = elements.articlePhotoSearchInput.value.trim().toLocaleLowerCase('ja');
    elements.articlePhotoOptions.replaceChildren();

    state.photos.filter((photo) => photo.registered).forEach((photo) => {
        const haystack = [photo.title, photo.alt, photo.file, photo.area].join(' ').toLocaleLowerCase('ja');
        if (query && !haystack.includes(query))
            return;
        const label = makeElement('label', 'article-photo-option');
        const image = document.createElement('img');
        image.src = photo.thumbUrl;
        image.alt = '';
        image.loading = 'lazy';
        const text = makeElement('span', '', photo.title || photo.file);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = photo.file;
        checkbox.checked = selected.has(photo.file);
        checkbox.addEventListener('change', updateArticlePhotoCount);
        label.append(image, text, checkbox);
        elements.articlePhotoOptions.append(label);
    });
    updateArticlePhotoCount();
}

function renderArticleHeroOptions() {
    const current = elements.articleHero.value;
    elements.articleHero.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '写真を選択';
    elements.articleHero.append(placeholder);
    state.photos.filter((photo) => photo.registered).forEach((photo) => {
        const option = document.createElement('option');
        option.value = photo.file;
        option.textContent = `${photo.title || photo.file} (${photo.file})`;
        elements.articleHero.append(option);
    });
    elements.articleHero.value = current;
}

function updateArticleHero(fillAlt = false) {
    const photo = state.photos.find((item) => item.file === elements.articleHero.value);
    elements.articleHeroPreview.replaceChildren();
    if (!photo) {
        elements.articleHeroPreview.append(makeElement('span', '', '写真を選択してください'));
        return;
    }
    const image = document.createElement('img');
    image.src = photo.thumbUrl;
    image.alt = photo.alt || photo.title;
    elements.articleHeroPreview.append(image);
    if (fillAlt)
        elements.articleHeroAlt.value = photo.alt || photo.title;
}

function updateArticleStatus() {
    const published = elements.articlePublished.checked;
    elements.articleStatusBadge.textContent = published ? '公開' : '下書き';
    elements.articleStatusBadge.classList.toggle('is-published', published);
}

function updateArticleDescriptionCount() {
    elements.articleDescriptionCount.textContent = `${Array.from(elements.articleDescription.value).length} / 180`;
}

function openArticle(article) {
    state.selectedArticle = { ...article, isNew: false };
    elements.articleEmpty.hidden = true;
    elements.articleForm.hidden = false;
    elements.articleFile.textContent = `_articles/${article.slug}.md`;
    elements.articleFormHeading.textContent = '記事を編集';
    elements.articleTitle.value = article.title;
    elements.articleDescription.value = article.description;
    elements.articleBody.value = article.body;
    elements.articleSlug.value = article.slug;
    elements.articleSlug.disabled = true;
    elements.articleCategory.value = article.category;
    elements.articleDate.value = article.date;
    elements.articleUpdated.value = article.updated;
    elements.articleService.value = article.serviceKey;
    elements.articlePublished.checked = article.published;
    elements.articleHero.value = article.heroFile;
    elements.articleHeroAlt.value = article.heroAlt;
    elements.deleteArticleButton.hidden = false;
    elements.articlePhotoSearchInput.value = '';
    renderArticlePhotoOptions(new Set(article.photos.map((photo) => photo.file)));
    updateArticleHero();
    updateArticleStatus();
    updateArticleDescriptionCount();
    renderArticleList();
}

function newArticle() {
    const date = today();
    const article = {
        slug: `article-${date.replaceAll('-', '')}`,
        title: '',
        description: '',
        category: '撮影ガイド',
        date,
        updated: date,
        heroFile: '',
        heroAlt: '',
        serviceKey: '',
        published: false,
        photos: [],
        body: '',
        isNew: true
    };
    state.selectedArticle = article;
    elements.articleEmpty.hidden = true;
    elements.articleForm.hidden = false;
    elements.articleFile.textContent = '新しい記事';
    elements.articleFormHeading.textContent = '記事を作成';
    elements.articleTitle.value = '';
    elements.articleDescription.value = '';
    elements.articleBody.value = '';
    elements.articleSlug.value = article.slug;
    elements.articleSlug.disabled = false;
    elements.articleCategory.value = article.category;
    elements.articleDate.value = date;
    elements.articleUpdated.value = date;
    elements.articleService.value = '';
    elements.articlePublished.checked = false;
    elements.articleHero.value = '';
    elements.articleHeroAlt.value = '';
    elements.deleteArticleButton.hidden = true;
    elements.articlePhotoSearchInput.value = '';
    renderArticlePhotoOptions(new Set());
    updateArticleHero();
    updateArticleStatus();
    updateArticleDescriptionCount();
    renderArticleList();
    elements.articleTitle.focus();
}

function closeArticle() {
    state.selectedArticle = null;
    elements.articleForm.hidden = true;
    elements.articleEmpty.hidden = false;
    renderArticleList();
}

function articleFormData() {
    const selectedFiles = articleSelectedPhotoFiles();
    return {
        slug: elements.articleSlug.value.trim(),
        title: elements.articleTitle.value.trim(),
        description: elements.articleDescription.value.trim(),
        category: elements.articleCategory.value.trim(),
        date: elements.articleDate.value,
        updated: elements.articleUpdated.value,
        serviceKey: elements.articleService.value,
        published: elements.articlePublished.checked,
        heroFile: elements.articleHero.value,
        heroAlt: elements.articleHeroAlt.value.trim(),
        photos: state.photos.filter((photo) => selectedFiles.has(photo.file)).map((photo) => ({
            file: photo.file,
            alt: photo.alt
        })),
        body: elements.articleBody.value.trim()
    };
}

async function saveArticle(event) {
    event.preventDefault();
    const selected = state.selectedArticle;
    if (!selected)
        return;
    const data = articleFormData();
    elements.saveArticleButton.disabled = true;
    elements.cancelArticleButton.disabled = true;
    elements.saveState.textContent = '記事を保存しています…';
    try {
        const response = await fetch(selected.isNew ? '/api/articles' : `/api/articles/${encodeURIComponent(selected.slug)}`, {
            method: selected.isNew ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || '記事を保存できませんでした。');
        await Promise.all([loadArticles(), loadCatalog()]);
        const saved = state.articles.find((article) => article.slug === result.article.slug);
        if (saved)
            openArticle(saved);
        showToast(data.published ? '記事を保存し、公開対象にしました。' : '記事を下書き保存しました。');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        elements.saveArticleButton.disabled = false;
        elements.cancelArticleButton.disabled = false;
        elements.saveState.textContent = '';
    }
}

function requestDeleteArticle() {
    if (!state.selectedArticle || state.selectedArticle.isNew)
        return;
    elements.deleteArticleDialogDescription.textContent = `「${state.selectedArticle.title}」を削除します。この操作は取り消せません。`;
    elements.deleteArticleDialog.showModal();
}

async function deleteArticle() {
    const selected = state.selectedArticle;
    if (!selected || selected.isNew)
        return;
    elements.deleteArticleDialog.close();
    elements.saveState.textContent = '記事を削除しています…';
    try {
        const response = await fetch(`/api/articles/${encodeURIComponent(selected.slug)}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || '記事を削除できませんでした。');
        await Promise.all([loadArticles(), loadCatalog()]);
        closeArticle();
        showToast('記事を削除しました。');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        elements.saveState.textContent = '';
    }
}

async function loadArticles() {
    const response = await fetch('/api/articles', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error || '記事一覧を読み込めませんでした。');
    state.articles = result.articles;
    if (state.services.length === 0)
        state.services = result.services;
    renderArticleServices();
    renderArticleHeroOptions();
    renderArticleList();
}

function updateAltCount() {
    elements.altCount.textContent = `${Array.from(elements.photoAlt.value).length}文字`;
}

function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', isError);
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
        elements.toast.hidden = true;
    }, isError ? 5000 : 3200);
}

[
    elements.searchInput,
    elements.categoryFilter,
    elements.referenceFilter,
    elements.needsDescriptionFilter,
    elements.sortSelect
].forEach((control) => control.addEventListener('input', renderCatalog));

elements.addButton.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', () => {
    addPendingFiles(elements.fileInput.files);
    elements.fileInput.value = '';
});
elements.closeDetail.addEventListener('click', closeDetail);
elements.cancelButton.addEventListener('click', closeDetail);
elements.deleteButton.addEventListener('click', requestDeleteSelected);
elements.deleteCancelButton.addEventListener('click', () => elements.deleteDialog.close());
elements.deleteConfirmButton.addEventListener('click', deleteSelected);
elements.detailForm.addEventListener('submit', saveSelected);
elements.photoAlt.addEventListener('input', updateAltCount);
elements.photosModeButton.addEventListener('click', () => switchMode('photos'));
elements.articlesModeButton.addEventListener('click', () => switchMode('articles'));
elements.newArticleButton.addEventListener('click', newArticle);
elements.articleSearchInput.addEventListener('input', renderArticleList);
elements.articlePhotoSearchInput.addEventListener('input', () => renderArticlePhotoOptions());
elements.articleHero.addEventListener('change', () => updateArticleHero(true));
elements.articleDescription.addEventListener('input', updateArticleDescriptionCount);
elements.articlePublished.addEventListener('change', updateArticleStatus);
elements.articleForm.addEventListener('submit', saveArticle);
elements.cancelArticleButton.addEventListener('click', closeArticle);
elements.deleteArticleButton.addEventListener('click', requestDeleteArticle);
elements.deleteArticleCancelButton.addEventListener('click', () => elements.deleteArticleDialog.close());
elements.deleteArticleConfirmButton.addEventListener('click', deleteArticle);
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected)
        closeDetail();
});

Promise.all([loadCatalog(), loadArticles()]).catch((error) => showToast(error.message, true));
