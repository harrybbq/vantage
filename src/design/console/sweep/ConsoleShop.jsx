/**
 * Console Shop. The classic ShopSection mounted whole (wishlist, link
 * autofill, the coin gate, categories and every write it makes), inside
 * the scoped token bridge so it draws in console tokens. Restyled, not
 * rebuilt: the shop's structure already does its job.
 *
 * The wrapper is display: contents (sweep.css), so the classic
 * section keeps its own `.section` offsets.
 */
import ShopSection from '../../../components/ShopSection';

export default function ConsoleShop({ S, update, onOpenModal, onShowCoinToast }) {
  return (
    <div className="cx-sweep-scope cx-sweep-shop">
      <ShopSection S={S} update={update} active onOpenModal={onOpenModal} onShowCoinToast={onShowCoinToast} />
    </div>
  );
}
