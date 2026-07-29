'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const YAML = require('yaml');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-desk-test-'));
const dataDir = path.join(fixtureRoot, '_data');
const fullsDir = path.join(fixtureRoot, 'images', 'fulls');
const thumbsDir = path.join(fixtureRoot, 'images', 'thumbs');
const sourcePath = path.join(fixtureRoot, 'source.png');
const port = 43000 + Math.floor(Math.random() * 1000);
let server;

function createFixture() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(fullsDir, { recursive: true });
    fs.mkdirSync(thumbsDir, { recursive: true });

    fs.writeFileSync(path.join(dataDir, 'photos.yml'), YAML.stringify([
        {
            file: 'existing.jpg',
            title: 'Existing',
            category: 'portfolio',
            area: '',
            alt: 'Existing alt',
            order: 1,
            featured: false
        }
    ]));
    fs.writeFileSync(path.join(dataDir, 'services.yml'), YAML.stringify({
        test: {
            name: 'Test Service',
            hero_image: '/images/fulls/existing.jpg',
            photos: [{ file: 'existing.jpg', alt: 'Service alt' }]
        }
    }));

    const imageResult = spawnSync('magick', ['-size', '120x90', 'xc:#4f8a70', sourcePath], {
        encoding: 'utf8'
    });
    assert.strictEqual(imageResult.status, 0, imageResult.stderr);
    fs.copyFileSync(sourcePath, path.join(fullsDir, 'existing.jpg'));
    fs.copyFileSync(sourcePath, path.join(thumbsDir, 'existing.jpg'));
    fs.copyFileSync(sourcePath, path.join(fullsDir, '_orphan.jpg'));
    fs.copyFileSync(sourcePath, path.join(thumbsDir, '_orphan.jpg'));
}

function startServer() {
    return new Promise((resolve, reject) => {
        server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
            env: {
                ...process.env,
                PHOTO_MANAGER_ROOT: fixtureRoot,
                PHOTO_MANAGER_PORT: String(port)
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        const timeout = setTimeout(() => reject(new Error(`Server start timeout: ${stderr}`)), 5000);
        server.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        server.stdout.on('data', (chunk) => {
            if (!chunk.toString().includes('Photo Desk:'))
                return;
            clearTimeout(timeout);
            resolve();
        });
        server.on('error', reject);
        server.on('exit', (code) => {
            if (code !== null && code !== 0)
                reject(new Error(`Server exited with ${code}: ${stderr}`));
        });
    });
}

async function requestJson(url, options) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, options);
    const body = await response.json();
    assert.ok(response.ok, body.error || `HTTP ${response.status}`);
    return body;
}

async function run() {
    createFixture();
    await startServer();

    const initial = await requestJson('/api/photos');
    assert.strictEqual(initial.photos.length, 2);
    assert.strictEqual(initial.stats.unregistered, 1);
    assert.ok(initial.photos.some((photo) => photo.file === '_orphan.jpg' && photo.registered === false));
    assert.strictEqual(initial.photos[0].references.filter((ref) => ref.kind === 'service').length, 1);
    assert.strictEqual(initial.photos[0].references.filter((ref) => ref.kind === 'hero').length, 1);

    await requestJson('/api/photos/existing.jpg', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: 'Updated title',
            alt: 'Updated portfolio alt',
            category: 'portrait',
            area: '大阪',
            order: 1,
            featured: true,
            referenceAlts: { test: 'Updated service alt' }
        })
    });

    const updatedPhotos = YAML.parse(fs.readFileSync(path.join(dataDir, 'photos.yml'), 'utf8'));
    const updatedServices = YAML.parse(fs.readFileSync(path.join(dataDir, 'services.yml'), 'utf8'));
    assert.strictEqual(updatedPhotos[0].title, 'Updated title');
    assert.strictEqual(updatedServices.test.photos[0].alt, 'Updated service alt');

    await requestJson('/api/photos/register/_orphan.jpg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            outputName: 'registered-photo',
            title: 'Registered photo',
            alt: 'Registered photo alt',
            category: 'portrait',
            area: '京都',
            featured: false,
            serviceKeys: []
        })
    });
    assert.ok(fs.existsSync(path.join(fullsDir, 'registered-photo.jpg')));
    assert.ok(fs.existsSync(path.join(thumbsDir, 'registered-photo.jpg')));
    assert.ok(!fs.existsSync(path.join(fullsDir, '_orphan.jpg')));

    const metadata = {
        originalName: 'source.png',
        outputName: 'new-photo',
        title: 'New photo',
        alt: 'New photo alt',
        category: 'profile',
        area: '大阪',
        featured: false,
        serviceKeys: ['test']
    };
    await requestJson(`/api/photos/import?${new URLSearchParams({ meta: JSON.stringify(metadata) })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: fs.readFileSync(sourcePath)
    });

    assert.ok(fs.existsSync(path.join(fullsDir, 'new-photo.jpg')));
    assert.ok(fs.existsSync(path.join(thumbsDir, 'new-photo.jpg')));

    const finalPhotos = YAML.parse(fs.readFileSync(path.join(dataDir, 'photos.yml'), 'utf8'));
    const finalServices = YAML.parse(fs.readFileSync(path.join(dataDir, 'services.yml'), 'utf8'));
    assert.strictEqual(finalPhotos.length, 3);
    assert.ok(finalServices.test.photos.some((photo) => photo.file === 'new-photo.jpg'));

    console.log('Photo Desk smoke test passed.');
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        if (server)
            server.kill('SIGTERM');
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });
