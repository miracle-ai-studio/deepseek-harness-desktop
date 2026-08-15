const root = document.documentElement
const configuredRepository = root.dataset.repository
const releaseAsset = root.dataset.releaseAsset

function resolveRepository() {
  const hostname = window.location.hostname
  if (!hostname.endsWith('.github.io')) return configuredRepository
  const owner = hostname.slice(0, -'.github.io'.length)
  const repository = window.location.pathname.split('/').filter(Boolean)[0]
  return owner && repository ? `${owner}/${repository}` : configuredRepository
}

const repository = resolveRepository()
const repositoryUrl = `https://github.com/${repository}`
const downloadUrl = `${repositoryUrl}/releases/latest/download/${encodeURIComponent(releaseAsset)}`

document.querySelectorAll('[data-repository-link]').forEach(link => {
  link.href = repositoryUrl
})

document.querySelectorAll('[data-download]').forEach(link => {
  link.href = downloadUrl
})

const architectureLink = document.querySelector('[data-architecture-link]')
if (architectureLink) architectureLink.href = `${repositoryUrl}/blob/main/docs/architecture.md`

document.querySelectorAll('[data-year]').forEach(node => {
  node.textContent = String(new Date().getFullYear())
})

const languageButton = document.querySelector('[data-language-toggle]')
const translatableNodes = [...document.querySelectorAll('[data-zh][data-en]')]
const labelledNodes = [...document.querySelectorAll('[data-zh-label][data-en-label]')]

function applyLanguage(language) {
  root.lang = language === 'en' ? 'en' : 'zh-CN'
  translatableNodes.forEach(node => {
    node.innerHTML = node.dataset[language]
  })
  labelledNodes.forEach(node => {
    node.setAttribute('aria-label', node.dataset[`${language}Label`])
  })
  languageButton.textContent = language === 'en' ? '中文' : 'EN'
  languageButton.setAttribute('aria-label', language === 'en' ? '切换到中文' : 'Switch to English')
  try {
    window.localStorage.setItem('dsh-desktop-language', language)
  } catch {
    // A blocked storage API does not prevent language selection for this page view.
  }
}

let storedLanguage
try {
  storedLanguage = window.localStorage.getItem('dsh-desktop-language')
} catch {
  storedLanguage = undefined
}
applyLanguage(storedLanguage === 'en' ? 'en' : 'zh')

languageButton.addEventListener('click', () => {
  applyLanguage(root.lang === 'en' ? 'zh' : 'en')
})

const hyperframes = document.querySelector('[data-hyperframes]')
const framePanels = [...document.querySelectorAll('[data-hyperframe]')]
const frameButtons = [...document.querySelectorAll('[data-frame-target]')]
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let activeFrame = 0
let frameTimer

function showFrame(index) {
  activeFrame = (index + framePanels.length) % framePanels.length
  framePanels.forEach((panel, panelIndex) => {
    const isActive = panelIndex === activeFrame
    panel.classList.toggle('is-active', isActive)
    panel.setAttribute('aria-hidden', String(!isActive))
  })
  frameButtons.forEach((button, buttonIndex) => {
    const isActive = buttonIndex === activeFrame
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-selected', String(isActive))
  })
}

function stopFrameLoop() {
  window.clearInterval(frameTimer)
}

function startFrameLoop() {
  stopFrameLoop()
  if (reduceMotion.matches || framePanels.length < 2) return
  frameTimer = window.setInterval(() => showFrame(activeFrame + 1), 4800)
}

frameButtons.forEach((button, buttonIndex) => {
  button.addEventListener('click', () => {
    showFrame(buttonIndex)
    startFrameLoop()
  })
})

hyperframes?.addEventListener('mouseenter', stopFrameLoop)
hyperframes?.addEventListener('mouseleave', startFrameLoop)
hyperframes?.addEventListener('focusin', stopFrameLoop)
hyperframes?.addEventListener('focusout', startFrameLoop)
reduceMotion.addEventListener('change', startFrameLoop)
showFrame(0)
startFrameLoop()

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return
    entry.target.classList.add('is-visible')
    observer.unobserve(entry.target)
  })
}, { threshold: 0.14 })

document.querySelectorAll('.reveal:not(.is-visible)').forEach(node => observer.observe(node))

const copyButton = document.querySelector('[data-copy]')
const installCommand = document.querySelector('[data-install-command]')

copyButton?.addEventListener('click', async () => {
  const command = installCommand.textContent
    .replace(/^01\s+/m, '')
    .replace(/^02\s+/m, '')
    .trim()
  try {
    await navigator.clipboard.writeText(command)
    const previous = copyButton.textContent
    copyButton.textContent = root.lang === 'en' ? 'COPIED' : '已复制'
    window.setTimeout(() => { copyButton.textContent = previous }, 1500)
  } catch {
    installCommand.parentElement.focus()
  }
})
