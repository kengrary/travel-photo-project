import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

// 未设任何 env 覆盖时验证默认解析
delete process.env.DB_PATH
delete process.env.UPLOAD_DIR
delete process.env.GEO_DIR

const ROOT = path.resolve(import.meta.dirname, '..')

test('开发态：路径符合项目布局', async () => {
  const p = await import('./paths.js')
  assert.equal(p.IS_PACKAGED, false)
  assert.equal(p.BASE_DIR, ROOT)
  assert.equal(p.DATA_DIR, path.join(ROOT, 'server', 'data'))
  assert.equal(p.DB_PATH, path.join(ROOT, 'server', 'data', 'app.db'))
  assert.equal(p.GEO_DIR, path.join(ROOT, 'server', 'data', 'geojson'))
  assert.equal(p.UPLOAD_DIR, path.join(ROOT, 'uploads'))
  assert.equal(p.DIST_DIR, path.join(ROOT, 'dist'))
  assert.equal(p.BACKUPS_DIR, path.join(ROOT, 'backups'))
})

test('env 覆盖优先于默认值', async () => {
  process.env.DB_PATH = '/tmp/x/app.db'
  process.env.UPLOAD_DIR = '/tmp/x/uploads'
  process.env.GEO_DIR = '/tmp/x/geo'
  try {
    const p = await import('./paths.js?env')
    assert.equal(p.DB_PATH, path.resolve('/tmp/x/app.db'))
    assert.equal(p.UPLOAD_DIR, path.resolve('/tmp/x/uploads'))
    assert.equal(p.GEO_DIR, path.resolve('/tmp/x/geo'))
  } finally {
    delete process.env.DB_PATH
    delete process.env.UPLOAD_DIR
    delete process.env.GEO_DIR
  }
})

test('打包态（process.pkg）：数据目录落在 exe 同目录', async () => {
  process.pkg = {} // 模拟 @yao-pkg/pkg 注入
  process.execPath = '/fake/dir/TravelPhotoMap.exe'
  try {
    const p = await import('./paths.js?packaged')
    assert.equal(p.IS_PACKAGED, true)
    assert.equal(p.BASE_DIR, path.resolve('/fake/dir'))
    assert.equal(p.DATA_DIR, path.resolve('/fake/dir/data'))
    assert.equal(p.DB_PATH, path.resolve('/fake/dir/data/app.db'))
    assert.equal(p.GEO_DIR, path.resolve('/fake/dir/data/geojson'))
    assert.equal(p.UPLOAD_DIR, path.resolve('/fake/dir/uploads'))
    assert.equal(p.DIST_DIR, path.resolve('/fake/dir/dist'))
    assert.equal(p.BACKUPS_DIR, path.resolve('/fake/dir/backups'))
  } finally {
    delete process.pkg
  }
})
