'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');

const root = path.resolve(process.env.PHOTO_MANAGER_ROOT || path.join(__dirname, '..', '..'));
const publicDir = path.join(__dirname, 'public');
const photosPath = path.join(root, '_data', 'photos.yml');
const servicesPath = path.join(root, '_data', 'services.yml');
const fullsDir = path.join(root, 'images', 'fulls');
const thumbsDir = path.join(root, 'images', 'thumbs');
const host = '127.0.0.1';
const port = Number(process.env.PHOTO_MANAGER_PORT || 4173);
const maxUploadBytes = 80 * 1024 * 1024;
const allowedSourceExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff']);
const allowedCategories = new Set(['portrait', 'profile', 'cosplay', 'event', 'animal', 'landscape', 'portfolio']);

let mutationQueue = Promise.resolve();
let stagingQueue = Promise.resolve();
const stagedUploads = new Map();

function readYaml(filePath, fallback) {
    if (!fs.existsSync(filePath))
        return fallback;
    return YAML.parse(fs.readFileSync(filePath, 'utf8')) || fallback;
}

function stringifyPhotos(photos) {
    return '# Photo manifest. Managed by Photo Desk or `npm run photos:sync`.\n\n'
        + YAML.stringify(photos, { lineWidth: 0 });
}

function stringifyServices(services) {
    return YAML.stringify(services, { lineWidth: 0 });
}

function atomicWriteMany(files) {
    const prepared = files.map((file) => {
        const tempPath = `${file.path}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        return {
            ...file,
            tempPath,
            original: fs.existsSync(file.path) ? fs.readFileSync(file.path) : null
        };
    });
    const applied = [];

    try {
        prepared.forEach((file) => fs.writeFileSync(file.tempPath, file.content, 'utf8'));
        prepared.forEach((file) => {
            fs.renameSync(file.tempPath, file.path);
            applied.push(file);
        });
    } catch (error) {
        prepared.forEach((file) => {
            if (fs.existsSync(file.tempPath))
                fs.unlinkSync(file.tempPath);
        });
        applied.reverse().forEach((file) => {
            if (file.original === null) {
                if (fs.existsSync(file.path))
                    fs.unlinkSync(file.path);
            } else {
                fs.writeFileSync(file.path, file.original);
            }
        });
        throw error;
    }
}

function serializeMutation(task) {
    const next = mutationQueue.then(task, task);
    mutationQueue = next.catch(() => {});
    return next;
}

function serializeStaging(task) {
    const next = stagingQueue.then(task, task);
    stagingQueue = next.catch(() => {});
    return next;
}

function normalizePhoto(photo, index) {
    return {
        file: String(photo.file || ''),
        title: String(photo.title || ''),
        category: allowedCategories.has(photo.category) ? photo.category : 'portfolio',
        area: String(photo.area || ''),
        alt: String(photo.alt || ''),
        order: Number.isFinite(Number(photo.order)) ? Number(photo.order) : index + 1,
        featured: Boolean(photo.featured)
    };
}

function readReferenceSources() {
    return [
        '_config.yml',
        'request/index.html',
        'request/portrait-kansai/index.html',
        'request/profile-photo-osaka/index.html',
        'request/cosplay-kansai/index.html',
        'privacy/index.html'
    ].flatMap((relativePath) => {
        const absolutePath = path.join(root, relativePath);
        if (!fs.existsSync(absolutePath))
            return [];
        return [{
            relativePath,
            source: fs.readFileSync(absolutePath, 'utf8')
        }];
    });
}

function collectReferences(photo, services, registered = true, sourceFiles = readReferenceSources()) {
    const references = registered
        ? [
            {
                kind: 'portfolio',
                label: 'トップページの作品一覧',
                source: '_data/photos.yml',
                alt: photo.alt,
                editable: false
            },
            {
                kind: 'sitemap',
                label: '画像サイトマップ',
                source: 'sitemap.xml',
                alt: photo.alt,
                editable: false
            }
        ]
        : [];

    Object.entries(services).forEach(([serviceKey, service]) => {
        if (String(service.hero_image || '').endsWith(`/${photo.file}`)) {
            references.push({
                kind: 'hero',
                label: `${service.name}のメイン画像`,
                source: '_data/services.yml',
                serviceKey,
                alt: service.name,
                editable: false
            });
        }

        (service.photos || []).forEach((servicePhoto, photoIndex) => {
            if (servicePhoto.file !== photo.file)
                return;
            references.push({
                kind: 'service',
                label: `${service.name}の作例`,
                source: '_data/services.yml',
                serviceKey,
                photoIndex,
                alt: String(servicePhoto.alt || ''),
                editable: true
            });
        });
    });

    sourceFiles.forEach(({ relativePath, source }) => {
        if (!source.includes(photo.file))
            return;
        references.push({
            kind: 'source',
            label: relativePath === '_config.yml' ? 'サイト共通画像設定' : `${relativePath}のOG画像`,
            source: relativePath,
            alt: '',
            editable: false
        });
    });

    return references;
}

function getCatalog() {
    const photos = readYaml(photosPath, []).map(normalizePhoto);
    const services = readYaml(servicesPath, {});
    const sourceFiles = readReferenceSources();
    const registeredFiles = new Set(photos.map((photo) => photo.file));
    const fullFiles = fs.readdirSync(fullsDir)
        .filter((file) => allowedSourceExtensions.has(path.extname(file).toLowerCase()))
        .sort();
    const orphans = fullFiles
        .filter((file) => !registeredFiles.has(file))
        .map((file, index) => normalizePhoto({
            file,
            title: path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim(),
            category: 'portfolio',
            area: '',
            alt: '',
            order: photos.length + index + 1,
            featured: false
        }, photos.length + index));
    const catalogPhotos = [
        ...photos.map((photo) => ({ photo, registered: true })),
        ...orphans.map((photo) => ({ photo, registered: false }))
    ];
    const serviceOptions = Object.entries(services).map(([key, service]) => ({
        key,
        name: service.name
    }));

    return {
        photos: catalogPhotos.map(({ photo, registered }) => ({
            ...photo,
            registered,
            fullUrl: `/media/fulls/${encodeURIComponent(photo.file)}`,
            thumbUrl: fs.existsSync(path.join(thumbsDir, photo.file))
                ? `/media/thumbs/${encodeURIComponent(photo.file)}`
                : `/media/fulls/${encodeURIComponent(photo.file)}`,
            references: collectReferences(photo, services, registered, sourceFiles)
        })),
        services: serviceOptions,
        categories: Array.from(allowedCategories),
        stats: {
            total: catalogPhotos.length,
            described: photos.filter((photo) => !photo.alt.includes('ポートフォリオ作品「')).length,
            referenced: photos.filter((photo) => collectReferences(photo, services, true, sourceFiles).some((ref) => ref.kind === 'service' || ref.kind === 'hero')).length,
            unregistered: orphans.length
        }
    };
}

function validateMetadata(input, existingPhoto) {
    const title = String(input.title || '').trim();
    const alt = String(input.alt || '').trim();
    const category = String(input.category || 'portfolio');
    const area = String(input.area || '').trim();
    const order = Number(input.order);

    if (!title)
        throw new Error('タイトルを入力してください。');
    if (!alt)
        throw new Error('altを入力してください。');
    if (!allowedCategories.has(category))
        throw new Error('カテゴリが不正です。');
    if (!Number.isFinite(order) || order < 1)
        throw new Error('表示順は1以上の数値で入力してください。');

    return {
        file: existingPhoto ? existingPhoto.file : '',
        title,
        category,
        area,
        alt,
        order,
        featured: Boolean(input.featured)
    };
}

function updatePhoto(fileName, input) {
    const photos = readYaml(photosPath, []).map(normalizePhoto);
    const services = readYaml(servicesPath, {});
    const index = photos.findIndex((photo) => photo.file === fileName);

    if (index < 0)
        throw new Error('写真が見つかりません。');

    photos[index] = validateMetadata(input, photos[index]);

    const referenceAlts = input.referenceAlts && typeof input.referenceAlts === 'object'
        ? input.referenceAlts
        : {};

    Object.entries(referenceAlts).forEach(([serviceKey, value]) => {
        const service = services[serviceKey];
        if (!service || !Array.isArray(service.photos))
            return;
        service.photos.forEach((servicePhoto) => {
            if (servicePhoto.file === fileName)
                servicePhoto.alt = String(value || '').trim() || photos[index].alt;
        });
    });

    const addServiceKeys = Array.isArray(input.addServiceKeys) ? input.addServiceKeys : [];
    addServiceKeys.forEach((serviceKey) => {
        const service = services[serviceKey];
        if (!service)
            return;
        if (!Array.isArray(service.photos))
            service.photos = [];
        if (!service.photos.some((servicePhoto) => servicePhoto.file === fileName))
            service.photos.push({ file: fileName, alt: photos[index].alt });
    });

    atomicWriteMany([
        { path: photosPath, content: stringifyPhotos(photos) },
        { path: servicesPath, content: stringifyServices(services) }
    ]);

    return photos[index];
}

function deletePhoto(fileName) {
    const photos = readYaml(photosPath, []).map(normalizePhoto);
    const services = readYaml(servicesPath, {});
    const photoIndex = photos.findIndex((photo) => photo.file === fileName);
    const photo = photoIndex >= 0 ? photos[photoIndex] : null;
    const fullPath = path.join(fullsDir, fileName);
    const thumbPath = path.join(thumbsDir, fileName);

    if (!photo && !fs.existsSync(fullPath) && !fs.existsSync(thumbPath))
        throw new Error('写真が見つかりません。');

    if (photo) {
        const blockingReferences = collectReferences(photo, services, true)
            .filter((reference) => reference.kind === 'hero' || reference.kind === 'source');
        if (blockingReferences.length > 0) {
            const locations = blockingReferences.map((reference) => reference.label).join('、');
            throw new Error(`この写真は「${locations}」で直接使用中です。先に参照先の画像を変更してください。`);
        }
    }

    const nextPhotos = photo ? photos.filter((item) => item.file !== fileName) : photos;
    if (photo) {
        Object.values(services).forEach((service) => {
            if (Array.isArray(service.photos))
                service.photos = service.photos.filter((servicePhoto) => servicePhoto.file !== fileName);
        });
    }

    const movedFiles = [fullPath, thumbPath]
        .filter((filePath) => fs.existsSync(filePath))
        .map((filePath) => ({
            original: filePath,
            backup: `${filePath}.photo-desk-delete-${crypto.randomBytes(4).toString('hex')}`
        }));
    let deletionCommitted = false;

    try {
        movedFiles.forEach((file) => fs.renameSync(file.original, file.backup));
        if (photo) {
            atomicWriteMany([
                { path: photosPath, content: stringifyPhotos(nextPhotos) },
                { path: servicesPath, content: stringifyServices(services) }
            ]);
        }
        deletionCommitted = true;
        movedFiles.forEach((file) => fs.unlinkSync(file.backup));
    } catch (error) {
        if (!deletionCommitted) {
            movedFiles.slice().reverse().forEach((file) => {
                if (fs.existsSync(file.backup) && !fs.existsSync(file.original))
                    fs.renameSync(file.backup, file.original);
            });
        }
        throw error;
    }

    return { file: fileName, registered: Boolean(photo) };
}

function sanitizeOutputName(requestedName, originalName) {
    const requestedBase = path.basename(String(requestedName || '')).replace(/\.[^.]+$/, '');
    const safeRequested = requestedBase
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 80);

    if (safeRequested)
        return `${safeRequested}.jpg`;

    const originalBase = path.basename(String(originalName || '')).replace(/\.[^.]+$/, '');
    const safeOriginal = originalBase
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 48);
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const suffix = crypto.randomBytes(2).toString('hex');
    return `${safeOriginal || 'photo'}-${timestamp}-${suffix}.jpg`;
}

function runMagick(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('magick', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(stderr.trim() || `ImageMagickが終了コード${code}で失敗しました。`));
        });
    });
}

function discardStagedUpload(token) {
    const staged = stagedUploads.get(token);
    if (!staged)
        return false;
    stagedUploads.delete(token);
    fs.rmSync(staged.tempDir, { recursive: true, force: true });
    return true;
}

async function stageUpload(source, originalName) {
    const token = crypto.randomBytes(16).toString('hex');
    const previewPath = path.join(source.tempDir, 'preview.jpg');

    try {
        await runMagick([
            source.tempPath,
            '-auto-orient',
            '-resize', '384x384>',
            '-strip',
            '-quality', '78',
            previewPath
        ]);
    } catch (error) {
        fs.rmSync(source.tempDir, { recursive: true, force: true });
        throw error;
    }

    stagedUploads.set(token, {
        ...source,
        originalName,
        previewPath,
        createdAt: Date.now()
    });
    return {
        token,
        previewUrl: `/media/staged/${token}`
    };
}

async function receiveUpload(req, originalName) {
    const extension = path.extname(String(originalName || '')).toLowerCase();
    if (!allowedSourceExtensions.has(extension))
        throw new Error('JPEG、PNG、WebP、HEIC、TIFFのいずれかを選択してください。');

    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > maxUploadBytes)
        throw new Error('1枚あたり80MB以下の画像を選択してください。');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-desk-'));
    const tempPath = path.join(tempDir, `source${extension}`);
    let received = 0;

    try {
        await new Promise((resolve, reject) => {
            const stream = fs.createWriteStream(tempPath, { flags: 'wx' });

            req.on('data', (chunk) => {
                received += chunk.length;
                if (received > maxUploadBytes) {
                    req.destroy();
                    stream.destroy();
                    reject(new Error('1枚あたり80MB以下の画像を選択してください。'));
                }
            });
            req.on('error', reject);
            stream.on('error', reject);
            stream.on('finish', resolve);
            req.pipe(stream);
        });

        if (received === 0)
            throw new Error('画像データを受信できませんでした。');
        return { tempDir, tempPath };
    } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw error;
    }
}

async function importPhoto(source, metadata) {
    const photos = readYaml(photosPath, []).map(normalizePhoto);
    const services = readYaml(servicesPath, {});
    const fileName = sanitizeOutputName(metadata.outputName, metadata.originalName);
    const fullTarget = path.join(fullsDir, fileName);
    const thumbTarget = path.join(thumbsDir, fileName);

    if (fs.existsSync(fullTarget) || fs.existsSync(thumbTarget) || photos.some((photo) => photo.file === fileName))
        throw new Error('同じファイル名の写真がすでにあります。別のファイル名を指定してください。');

    const maxOrder = photos.reduce((max, photo) => Math.max(max, Number(photo.order) || 0), 0);
    const photo = validateMetadata({
        ...metadata,
        order: maxOrder + 1
    }, null);
    photo.file = fileName;

    const fullTemp = path.join(fullsDir, `.photo-desk-${crypto.randomBytes(5).toString('hex')}.jpg`);
    const thumbTemp = path.join(thumbsDir, `.photo-desk-${crypto.randomBytes(5).toString('hex')}.jpg`);
    const selectedServices = Array.isArray(metadata.serviceKeys) ? metadata.serviceKeys : [];
    let imagesCommitted = false;

    try {
        await runMagick([
            source.tempPath,
            '-auto-orient',
            '-resize', '1024x1024>',
            '-quality', '88',
            fullTemp
        ]);
        if (source.previewPath && fs.existsSync(source.previewPath)) {
            fs.copyFileSync(source.previewPath, thumbTemp);
        } else {
            await runMagick([
                source.tempPath,
                '-auto-orient',
                '-resize', '384x384>',
                '-strip',
                '-quality', '78',
                thumbTemp
            ]);
        }

        photos.push(photo);
        selectedServices.forEach((serviceKey) => {
            const service = services[serviceKey];
            if (!service)
                return;
            if (!Array.isArray(service.photos))
                service.photos = [];
            service.photos.push({ file: fileName, alt: photo.alt });
        });

        fs.renameSync(fullTemp, fullTarget);
        fs.renameSync(thumbTemp, thumbTarget);
        imagesCommitted = true;

        atomicWriteMany([
            { path: photosPath, content: stringifyPhotos(photos) },
            { path: servicesPath, content: stringifyServices(services) }
        ]);
    } catch (error) {
        [fullTemp, thumbTemp].forEach((filePath) => {
            if (fs.existsSync(filePath))
                fs.unlinkSync(filePath);
        });
        if (imagesCommitted) {
            [fullTarget, thumbTarget].forEach((filePath) => {
                if (fs.existsSync(filePath))
                    fs.unlinkSync(filePath);
            });
        }
        throw error;
    } finally {
        fs.rmSync(source.tempDir, { recursive: true, force: true });
    }

    return photo;
}

async function registerOrphan(fileName, metadata) {
    const sourcePath = path.join(fullsDir, fileName);
    if (!fs.existsSync(sourcePath))
        throw new Error('未登録写真が見つかりません。');

    const sourceExtension = path.extname(fileName).toLowerCase();
    if (!allowedSourceExtensions.has(sourceExtension))
        throw new Error('この画像形式は登録できません。');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-desk-register-'));
    const tempPath = path.join(tempDir, `source${sourceExtension}`);
    fs.copyFileSync(sourcePath, tempPath);

    let outputName = sanitizeOutputName(metadata.outputName, fileName);
    if (outputName === fileName) {
        const baseName = path.basename(outputName, '.jpg');
        outputName = `${baseName}-portfolio.jpg`;
    }
    const source = { tempDir, tempPath };
    const photo = await importPhoto(source, {
        ...metadata,
        originalName: fileName,
        outputName: outputName.replace(/\.jpg$/i, '')
    });

    const oldThumb = path.join(thumbsDir, fileName);
    if (fileName !== photo.file) {
        if (fs.existsSync(sourcePath))
            fs.unlinkSync(sourcePath);
        if (fs.existsSync(oldThumb))
            fs.unlinkSync(oldThumb);
    }

    return photo;
}

function sendJson(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function sendError(res, error, status = 400) {
    sendJson(res, status, { error: error.message || '処理に失敗しました。' });
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
                reject(new Error('リクエストが大きすぎます。'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch {
                reject(new Error('入力データを読み取れませんでした。'));
            }
        });
        req.on('error', reject);
    });
}

function serveFile(res, filePath, contentType, cacheControl = 'no-store') {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(res, 404, { error: 'ファイルが見つかりません。' });
        return;
    }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': cacheControl
    });
    fs.createReadStream(filePath).pipe(res);
}

function mediaType(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.png')
        return 'image/png';
    if (extension === '.webp')
        return 'image/webp';
    return 'image/jpeg';
}

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${host}:${port}`);
    const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);
    const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);

    if (!allowedHosts.has(req.headers.host)) {
        sendJson(res, 403, { error: 'ローカルホスト以外からは利用できません。' });
        return;
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
        && req.headers.origin
        && !allowedOrigins.has(req.headers.origin)) {
        sendJson(res, 403, { error: '別のWebサイトからの更新は許可されていません。' });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/photos') {
        sendJson(res, 200, getCatalog());
        return;
    }

    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(204, { 'Cache-Control': 'private, max-age=86400' });
        res.end();
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/staging') {
        const originalName = url.searchParams.get('name') || '';
        try {
            const source = await receiveUpload(req, originalName);
            const staged = await serializeStaging(() => stageUpload(source, originalName));
            sendJson(res, 201, staged);
        } catch (error) {
            sendError(res, error);
        }
        return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/staging/')) {
        const token = url.pathname.slice('/api/staging/'.length);
        if (!/^[a-f0-9]{32}$/.test(token) || !discardStagedUpload(token)) {
            sendJson(res, 404, { error: '追加待ちの写真が見つかりません。' });
            return;
        }
        sendJson(res, 200, { token });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/photos/import-staged') {
        try {
            const input = await readJson(req);
            const token = String(input.stageToken || '');
            const staged = stagedUploads.get(token);
            if (!staged)
                throw new Error('追加待ちの写真が見つかりません。もう一度写真を追加してください。');
            const metadata = {
                ...(input.metadata || {}),
                originalName: staged.originalName
            };
            const photo = await serializeMutation(() => importPhoto(staged, metadata));
            stagedUploads.delete(token);
            sendJson(res, 201, { photo });
        } catch (error) {
            for (const [token, staged] of stagedUploads) {
                if (!fs.existsSync(staged.tempPath))
                    stagedUploads.delete(token);
            }
            sendError(res, error);
        }
        return;
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/api/photos/')) {
        const fileName = path.basename(decodeURIComponent(url.pathname.slice('/api/photos/'.length)));
        try {
            const input = await readJson(req);
            const photo = await serializeMutation(() => updatePhoto(fileName, input));
            sendJson(res, 200, { photo });
        } catch (error) {
            sendError(res, error);
        }
        return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/photos/')) {
        const fileName = path.basename(decodeURIComponent(url.pathname.slice('/api/photos/'.length)));
        try {
            const result = await serializeMutation(() => deletePhoto(fileName));
            sendJson(res, 200, result);
        } catch (error) {
            sendError(res, error);
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/photos/import') {
        let metadata;
        try {
            metadata = JSON.parse(url.searchParams.get('meta') || '{}');
            const source = await receiveUpload(req, metadata.originalName);
            const photo = await serializeMutation(() => importPhoto(source, metadata));
            sendJson(res, 201, { photo });
        } catch (error) {
            sendError(res, error);
        }
        return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/photos/register/')) {
        const fileName = path.basename(decodeURIComponent(url.pathname.slice('/api/photos/register/'.length)));
        try {
            const input = await readJson(req);
            const photo = await serializeMutation(() => registerOrphan(fileName, input));
            sendJson(res, 201, { photo });
        } catch (error) {
            sendError(res, error);
        }
        return;
    }

    const mediaMatch = url.pathname.match(/^\/media\/(fulls|thumbs)\/(.+)$/);
    if (req.method === 'GET' && mediaMatch) {
        const directory = mediaMatch[1] === 'fulls' ? fullsDir : thumbsDir;
        const decoded = decodeURIComponent(mediaMatch[2]);
        const fileName = path.basename(decoded);
        if (fileName !== decoded) {
            sendJson(res, 400, { error: 'ファイル名が不正です。' });
            return;
        }
        serveFile(res, path.join(directory, fileName), mediaType(fileName), 'private, max-age=300');
        return;
    }

    const stagedMediaMatch = url.pathname.match(/^\/media\/staged\/([a-f0-9]{32})$/);
    if (req.method === 'GET' && stagedMediaMatch) {
        const staged = stagedUploads.get(stagedMediaMatch[1]);
        if (!staged) {
            sendJson(res, 404, { error: '追加待ちの写真が見つかりません。' });
            return;
        }
        serveFile(res, staged.previewPath, 'image/jpeg', 'no-store');
        return;
    }

    const staticFiles = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
        '/styles.css': ['styles.css', 'text/css; charset=utf-8']
    };
    const staticFile = staticFiles[url.pathname];
    if (req.method === 'GET' && staticFile) {
        serveFile(res, path.join(publicDir, staticFile[0]), staticFile[1]);
        return;
    }

    sendJson(res, 404, { error: 'ページが見つかりません。' });
}

const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
    );
    handleRequest(req, res).catch((error) => sendError(res, error, 500));
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE')
        console.error(`ポート${port}は使用中です。すでにPhoto Deskが開いていないか確認してください。`);
    else
        console.error(error.message);
    process.exitCode = 1;
});

server.listen(port, host, () => {
    console.log(`Photo Desk: http://${host}:${port}`);
    console.log('終了するには Ctrl+C を押してください。');
});

const stagingCleanupTimer = setInterval(() => {
    const expiration = Date.now() - (2 * 60 * 60 * 1000);
    for (const [token, staged] of stagedUploads) {
        if (staged.createdAt < expiration)
            discardStagedUpload(token);
    }
}, 15 * 60 * 1000);
stagingCleanupTimer.unref();

process.on('exit', () => {
    for (const token of Array.from(stagedUploads.keys()))
        discardStagedUpload(token);
});
