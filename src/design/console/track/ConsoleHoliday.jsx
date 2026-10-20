/**
 * The 'holiday' route in console mode. Holiday is merged into Track, so
 * this renders Track itself, on Calendar › Year — every trip at a
 * glance, the next trip and Visited (the old Holiday › Visited tab with
 * its map). No navigate() call: there is no route that can carry a
 * view, and rendering in place keeps deep links and saved tabs working.
 */
import ConsoleTrack from './ConsoleTrack';

export default function ConsoleHoliday(props) {
  return <ConsoleTrack {...props} initialView="year" />;
}
