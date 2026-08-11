/**
 * A settings subsection: a heading, a line of explanation, the controls.
 *
 * Every one of these used to be a `.card` — a bordered, blurred, glowing
 * box with 22px of inline padding. A settings tab was then a stack of
 * boxes inside a page, each one framing a heading that did not need a
 * frame, and the borders carried more visual weight than the settings
 * they contained. They are all the same kind of thing, read top to
 * bottom, so a header and a hairline separate them just as well and the
 * column reads as one list instead of ten tiles.
 *
 * It lives in its own file rather than in SettingsSection because the
 * panels SettingsSection imports (macros, notifications, subscription,
 * export, travel policy) all need it too, and importing it back from
 * their parent would close an import cycle.
 *
 * `tone="danger"` is the one variant: it recolours the heading rather
 * than drawing a red box, which is what the delete-account group used to
 * rely on to look different from everything above it.
 */
export default function SettingsGroup({ title, desc, children, tone, id }) {
  return (
    <section className={'settings-group' + (tone ? ` settings-group-${tone}` : '')} id={id}>
      <h3 className="settings-group-title">{title}</h3>
      {desc && <p className="settings-group-desc">{desc}</p>}
      {children}
    </section>
  );
}
