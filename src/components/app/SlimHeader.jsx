import GearMenu from './GearMenu'

function SlimHeader({
  notebookTitle,
  sectionTitle,
  pageTitle,
  mobileTitle,
  settingsActive = false,
  sidebarOpen = false,
  onToggleSidebar,
  onOpenSettings,
  onSignOut,
}) {
  const breadcrumbParts = [notebookTitle, sectionTitle, pageTitle].filter(Boolean)
  const compactTitle = mobileTitle || pageTitle || sectionTitle || notebookTitle || 'Life Tracker'

  return (
    <header className="slim-header">
      <div className="slim-header-left">
        <button
          type="button"
          className={`ghost hamburger ${sidebarOpen ? 'active' : ''}`}
          aria-label={sidebarOpen ? 'Close navigation sidebar' : 'Open navigation sidebar'}
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <HamburgerIcon />
        </button>
        <div className="slim-header-brand" aria-hidden="true">
          <LogoMark />
        </div>
        <div className="breadcrumb-wrap">
          <p className="breadcrumb breadcrumb-full" title={breadcrumbParts.join(' / ')}>
            {breadcrumbParts.length > 0 ? breadcrumbParts.join(' / ') : 'Life Tracker'}
          </p>
          <p className="breadcrumb breadcrumb-mobile" title={compactTitle}>
            {compactTitle}
          </p>
        </div>
      </div>
      <GearMenu settingsActive={settingsActive} onOpenSettings={onOpenSettings} onSignOut={onSignOut} />
    </header>
  )
}

function LogoMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#0D9488" />
      <path
        d="M12 28L20 20L26 26L36 16"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 16H36V22"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default SlimHeader
