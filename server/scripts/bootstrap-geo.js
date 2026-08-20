import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../data/geojson')
fs.mkdirSync(OUT, { recursive: true })

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'
const SLEEP_MS = 120

async function fetchJSON(url) {
  const res = await fetch(url)
  if (res.status === 404) return null // 部分区域（如台湾 710000）无城市层数据，跳过而非中断
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data))
  console.log('saved', name)
}

// 直辖市：city 层即区县，无真正"市"层级
const MUNICIPALITIES = new Set(['110000', '120000', '310000', '500000'])

async function main() {
  const provinces = await fetchJSON(`${BASE}/100000_full.json`)
  if (!provinces) throw new Error('100000_full.json not found')
  save('100000_full.json', provinces)

  const index = []

  for (const prov of provinces.features) {
    const p = prov.properties
    const provAdcode = String(p.adcode)
    const provName = p.name
    const provFile = `${provAdcode}_full.json`

    if (!fs.existsSync(path.join(OUT, provFile))) {
      const data = await fetchJSON(`${BASE}/${provFile}`)
      if (!data) {
        console.warn('skip 404', provFile)
        continue
      }
      save(provFile, data)
      await new Promise((r) => setTimeout(r, SLEEP_MS))
    }
    const provData = JSON.parse(fs.readFileSync(path.join(OUT, provFile), 'utf8'))

    for (const cityFeat of provData.features) {
      const c = cityFeat.properties
      const cityAdcode = String(c.adcode)
      const cityName = c.name

      const isMunicipality = MUNICIPALITIES.has(provAdcode)
      // 直辖市：city 字段 = 直辖市名，county = 区县
      const cityField = isMunicipality ? provName : cityName
      const countyField = isMunicipality ? cityName : ''

      index.push({
        adcode: cityAdcode, name: cityName, level: c.level,
        parentAdcode: provAdcode, province: provName, city: cityField, county: countyField,
      })

      // 有下一级（非直辖市）时下载区县文件
      if (!isMunicipality && c.childrenNum > 0) {
        const countyFile = `${cityAdcode}_full.json`
        if (!fs.existsSync(path.join(OUT, countyFile))) {
          const data = await fetchJSON(`${BASE}/${countyFile}`)
          if (!data) {
            console.warn('skip 404', countyFile)
          } else {
            save(countyFile, data)
            await new Promise((r) => setTimeout(r, SLEEP_MS))
          }
        }
        if (!fs.existsSync(path.join(OUT, countyFile))) continue
        const countyData = JSON.parse(fs.readFileSync(path.join(OUT, countyFile), 'utf8'))
        for (const countyFeat of countyData.features) {
          const cc = countyFeat.properties
          index.push({
            adcode: String(cc.adcode), name: cc.name, level: cc.level,
            parentAdcode: cityAdcode, province: provName, city: cityName, county: cc.name,
          })
        }
      }
    }
  }

  save('index.json', index)
  console.log('index entries:', index.length)
}

main().catch((e) => { console.error(e); process.exit(1) })
