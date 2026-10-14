import './Branding.css'

const SITE_HOME = '/'
const COFFEE_URL = 'https://www.buymeacoffee.com/awmPhysics'
const CONTACT_EMAIL = 'hello@alexmoorephysics.com'
const LOGO_SRC = `${import.meta.env.BASE_URL}favicon.svg`

export function BrandLogo({ className = '' }) {
  return (
    <a
      className={`awm-logo-link ${className}`.trim()}
      href={SITE_HOME}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="More simulations at alexmoorephysics.com"
      title="More simulations"
    >
      <img src={LOGO_SRC} alt="" />
    </a>
  )
}

export function SiteFooter() {
  return (
    <footer className="awm-footer">
      <a href={SITE_HOME} target="_blank" rel="noopener noreferrer">More simulations</a>
      <span aria-hidden="true">·</span>
      <a href={COFFEE_URL} target="_blank" rel="noopener noreferrer">Support the project ☕</a>
      <span aria-hidden="true">·</span>
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </footer>
  )
}
