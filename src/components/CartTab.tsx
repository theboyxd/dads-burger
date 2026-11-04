import React, { useState } from 'react';
import { 
  ShoppingBag, Trash2, Plus, Minus, Send, MapPin, 
  CreditCard, Banknote, QrCode, ArrowLeft, Sparkles, CheckCircle2
} from 'lucide-react';
import { CartItem, DeliveryMode, MenuItem, PaymentMethod, StoreConfig } from '../types/menu';
import { 
  calculateSubtotal, calculateTotal, calculateDeliveryFee, 
  formatBRL, validateChange, buildWhatsAppOrderMessage 
} from '../utils/orderCalculator';

interface CartTabProps {
  cart: CartItem[];
  allMenuItems: MenuItem[];
  config: StoreConfig;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onClearCart: () => void;
  onGoToMenu: () => void;
  onShowToast: (msg: string) => void;
}

export const CartTab: React.FC<CartTabProps> = ({
  cart,
  allMenuItems,
  config,
  onUpdateQuantity,
  onClearCart,
  onGoToMenu,
  onShowToast
}) => {
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('entrega');
  const [address, setAddress] = useState('');
  const [reference, setReference] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [changeInput, setChangeInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const subtotal = calculateSubtotal(cart);
  const deliveryFee = calculateDeliveryFee(deliveryMode);
  const total = calculateTotal(cart, deliveryMode);

  // Upsell list: prioritizes sodas and cold drinks if no drink in cart, otherwise sides
  const hasDrinkInCart = cart.some(
    ci => ci.item.cat === 'Bebidas' || ci.item.name.toLowerCase().includes('coca') || ci.item.name.toLowerCase().includes('fruki')
  );

  const upsellCandidates = allMenuItems.filter(item => {
    const isAlreadyInCart = cart.some(ci => ci.item.id === item.id);
    if (isAlreadyInCart) return false;
    if (!hasDrinkInCart) {
      return item.cat === 'Bebidas';
    }
    return item.cat === 'Porções' || item.cat === 'Bebidas';
  }).slice(0, 8);

  const handleSendWhatsAppOrder = () => {
    if (cart.length === 0) {
      onShowToast('Adicione itens ao seu pedido primeiro!');
      return;
    }

    if (deliveryMode === 'entrega' && !address.trim()) {
      setValidationError('Por favor, informe a rua, número e bairro para entrega.');
      const addrInput = document.getElementById('delivery-address-input');
      if (addrInput) addrInput.focus();
      return;
    }

    if (paymentMethod === 'dinheiro') {
      const changeCheck = validateChange(changeInput, total);
      if (!changeCheck.valid) {
        setValidationError(changeCheck.error || 'Valor do troco inválido.');
        const trocoInput = document.getElementById('troco-input');
        if (trocoInput) trocoInput.focus();
        return;
      }
    }

    setValidationError(null);

    const changeVal = paymentMethod === 'dinheiro' && changeInput.trim()
      ? validateChange(changeInput, total).value
      : undefined;

    const message = buildWhatsAppOrderMessage({
      customerName: customerName.trim() || undefined,
      items: cart,
      mode: deliveryMode,
      deliveryAddress: address.trim(),
      deliveryReference: reference.trim(),
      paymentMethod,
      changeFor: changeVal,
      subtotal,
      deliveryFee,
      total
    });

    const cleanPhone = config.whats.replace(/\D/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
    onShowToast('Abrindo WhatsApp para enviar seu pedido! 🍔');
  };

  if (cart.length === 0) {
    return (
      <div className="py-12 px-4 max-w-xl mx-auto text-center space-y-5">
        <div className="w-20 h-20 mx-auto rounded-full bg-zinc-200/80 flex items-center justify-center text-zinc-400">
          <ShoppingBag className="w-10 h-10 stroke-[1.5]" />
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-zinc-900 tracking-tight">Seu pedido está vazio</h2>
          <p className="text-zinc-500 text-sm max-w-sm mx-auto">
            Explore nossos hambúrgueres artesanais, combos na caixa e porções para montar o seu lanche.
          </p>
        </div>
        <button
          onClick={onGoToMenu}
          className="bg-[#FAB309] hover:bg-[#d69700] text-black font-extrabold px-6 py-3.5 rounded-full shadow-md text-sm transition-transform active:scale-95 inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Ver o cardápio</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 max-w-3xl mx-auto pb-12">
      {/* Page Title */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 tracking-tight">Seu pedido</h2>
          <p className="text-xs sm:text-sm text-zinc-500 font-medium">Confira seus itens e escolha como prefere receber</p>
        </div>
        <button
          onClick={onClearCart}
          className="text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1 hover:underline p-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Limpar</span>
        </button>
      </div>

      {/* Cart Items List */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-zinc-200/80 shadow-xs space-y-4">
        <div className="divide-y divide-zinc-100">
          {cart.map(({ item, quantity }) => (
            <div key={item.id} className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={item.img}
                  alt={item.name}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover bg-zinc-100 flex-shrink-0"
                />
                <div className="min-w-0">
                  <h4 className="font-extrabold text-sm sm:text-base text-zinc-900 truncate">
                    {item.name}
                  </h4>
                  <p className="text-xs text-zinc-500">
                    {formatBRL(item.price)} cada
                  </p>
                  <p className="text-xs font-black text-amber-700 sm:hidden mt-0.5">
                    {formatBRL(item.price * quantity)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
                <span className="hidden sm:inline font-black text-sm text-zinc-900">
                  {formatBRL(item.price * quantity)}
                </span>

                <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-full border border-zinc-200">
                  <button
                    onClick={() => onUpdateQuantity(item.id, -1)}
                    aria-label="Diminuir quantidade"
                    className="w-7 h-7 rounded-full bg-white hover:bg-zinc-200 text-zinc-800 flex items-center justify-center transition-colors active:scale-90 shadow-2xs"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs sm:text-sm font-black w-4 text-center">
                    {quantity}
                  </span>
                  <button
                    onClick={() => onUpdateQuantity(item.id, 1)}
                    aria-label="Aumentar quantidade"
                    className="w-7 h-7 rounded-full bg-[#FAB309] hover:bg-[#d69700] text-black flex items-center justify-center transition-colors active:scale-90 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* "Peça Também" / Upsell Carousel */}
      {upsellCandidates.length > 0 && (
        <div className="bg-amber-50/60 rounded-3xl p-4 sm:p-5 border border-amber-200/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-sm sm:text-base text-zinc-950 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <span>{!hasDrinkInCart ? '🥤 Vai um refrigerante gelado?' : '🍟 Peça também para acompanhar'}</span>
              </h3>
              <p className="text-xs text-zinc-600">
                {!hasDrinkInCart ? 'Bebidas bem geladas para acompanhar seu pedido' : 'Acompanhamentos crocantes e bebidas'}
              </p>
            </div>
          </div>

          <div className="flex gap-2.5 overflow-x-auto no-scrollbar py-1">
            {upsellCandidates.map(candidate => (
              <div
                key={candidate.id}
                className="flex-shrink-0 w-36 sm:w-40 bg-white p-2.5 rounded-2xl border border-amber-200/80 shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow"
              >
                <div className="w-full h-20 rounded-xl overflow-hidden bg-zinc-100 mb-2">
                  <img
                    src={candidate.img}
                    alt={candidate.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div>
                  <h5 className="font-bold text-xs text-zinc-900 truncate" title={candidate.name}>
                    {candidate.name}
                  </h5>
                  <p className="text-[11px] text-zinc-500 truncate">{candidate.desc}</p>
                </div>
                <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-100">
                  <span className="font-black text-xs text-zinc-950">
                    {formatBRL(candidate.price)}
                  </span>
                  <button
                    onClick={() => {
                      onUpdateQuantity(candidate.id, 1);
                      onShowToast(`${candidate.name} adicionado!`);
                    }}
                    aria-label={`Adicionar ${candidate.name}`}
                    className="w-6 h-6 rounded-full bg-[#FAB309] hover:bg-[#d69700] text-black flex items-center justify-center font-black active:scale-90"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delivery Mode Toggle */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-zinc-200/80 shadow-xs space-y-4">
        <h3 className="font-black text-sm sm:text-base text-zinc-950">Como deseja receber?</h3>
        <div className="grid grid-cols-2 gap-2 bg-zinc-100 p-1.5 rounded-2xl">
          <button
            type="button"
            onClick={() => setDeliveryMode('entrega')}
            className={`py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              deliveryMode === 'entrega'
                ? 'bg-[#121212] text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <MapPin className="w-4 h-4 text-[#FAB309]" />
            <span>Entrega em domicílio</span>
          </button>
          <button
            type="button"
            onClick={() => setDeliveryMode('retirada')}
            className={`py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              deliveryMode === 'retirada'
                ? 'bg-[#121212] text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <ShoppingBag className="w-4 h-4 text-[#FAB309]" />
            <span>Retirar no balcão</span>
          </button>
        </div>

        {/* Delivery Address Form */}
        {deliveryMode === 'entrega' ? (
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">
                Endereço de entrega <span className="text-red-500">*</span>
              </label>
              <input
                id="delivery-address-input"
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setValidationError(null);
                }}
                placeholder="Rua, número e bairro (ex: Rua Sapé, 947 - Passo d'Areia)"
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">
                Complemento ou ponto de referência <span className="text-zinc-400 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Apto, bloco, portão, perto de..."
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900"
              />
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 text-xs sm:text-sm text-zinc-700 space-y-1">
            <p className="font-extrabold text-zinc-900">Retirada no restaurante:</p>
            <p>{config.end}</p>
            <p className="text-zinc-500 text-xs">Seu pedido começará a ser preparado assim que confirmar no WhatsApp.</p>
          </div>
        )}

        {/* Customer Name */}
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1">
            Seu nome <span className="text-zinc-400 font-normal">(para identificação na comanda)</span>
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Como podemos te chamar?"
            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900"
          />
        </div>
      </div>

      {/* Payment Method Selector */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-zinc-200/80 shadow-xs space-y-4">
        <h3 className="font-black text-sm sm:text-base text-zinc-950">Forma de pagamento</h3>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setPaymentMethod('pix');
              setValidationError(null);
            }}
            className={`py-3 px-2 rounded-2xl border text-xs sm:text-sm font-extrabold flex flex-col items-center justify-center gap-1.5 transition-all ${
              paymentMethod === 'pix'
                ? 'bg-[#121212] text-white border-black shadow-xs'
                : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
            }`}
          >
            <QrCode className="w-5 h-5 text-[#FAB309]" />
            <span>PIX</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPaymentMethod('cartao');
              setValidationError(null);
            }}
            className={`py-3 px-2 rounded-2xl border text-xs sm:text-sm font-extrabold flex flex-col items-center justify-center gap-1.5 transition-all ${
              paymentMethod === 'cartao'
                ? 'bg-[#121212] text-white border-black shadow-xs'
                : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
            }`}
          >
            <CreditCard className="w-5 h-5 text-[#FAB309]" />
            <span>Cartão</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPaymentMethod('dinheiro');
              setValidationError(null);
            }}
            className={`py-3 px-2 rounded-2xl border text-xs sm:text-sm font-extrabold flex flex-col items-center justify-center gap-1.5 transition-all ${
              paymentMethod === 'dinheiro'
                ? 'bg-[#121212] text-white border-black shadow-xs'
                : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
            }`}
          >
            <Banknote className="w-5 h-5 text-[#FAB309]" />
            <span>Dinheiro</span>
          </button>
        </div>

        {/* Payment Helper Notes */}
        {paymentMethod === 'pix' && (
          <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-xs text-amber-900 space-y-1">
            <p className="font-bold flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Chave Pix enviada automaticamente no WhatsApp</span>
            </p>
            <p className="text-zinc-600">A chave Pix do Dad's Burger chegará na resposta do WhatsApp para você copiar e colar.</p>
          </div>
        )}

        {paymentMethod === 'cartao' && (
          <div className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
            <p className="font-bold text-zinc-900">
              {deliveryMode === 'entrega' ? 'Levamos a maquininha até você' : 'Pagamento no balcão'}
            </p>
            <p className="text-zinc-500">Aceitamos débito, crédito e vale-refeição principais.</p>
          </div>
        )}

        {paymentMethod === 'dinheiro' && (
          <div className="space-y-2 pt-1">
            <label className="block text-xs font-bold text-zinc-700">
              Precisa de troco para quanto? <span className="text-zinc-400 font-normal">(deixe vazio se for valor exato)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="troco-input"
                type="text"
                value={changeInput}
                onChange={(e) => {
                  setChangeInput(e.target.value);
                  setValidationError(null);
                }}
                placeholder={`Ex: ${Math.ceil(total / 50) * 50 || 100}`}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900 font-semibold"
              />
            </div>
          </div>
        )}
      </div>

      {/* Error Alert */}
      {validationError && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm font-bold flex items-center gap-2">
          <span>⚠️ {validationError}</span>
        </div>
      )}

      {/* Summary & Checkout Action */}
      <div className="bg-[#121212] text-white rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 border border-zinc-800">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-zinc-400">
            <span>Subtotal</span>
            <span>{formatBRL(subtotal)}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Taxa de entrega</span>
            <span className="text-emerald-400 font-bold">{deliveryMode === 'entrega' ? 'Grátis' : 'Balcão'}</span>
          </div>
          <div className="border-t border-zinc-800 pt-2 flex justify-between items-baseline">
            <span className="text-lg font-bold text-white">Total</span>
            <span className="text-2xl sm:text-3xl font-black text-[#FAB309]">
              {formatBRL(total)}
            </span>
          </div>
        </div>

        <button
          onClick={handleSendWhatsAppOrder}
          className="w-full py-4 px-6 rounded-2xl bg-[#FAB309] hover:bg-[#d69700] text-black font-black text-base sm:text-lg flex items-center justify-center gap-2.5 transition-all shadow-lg active:scale-95"
        >
          <Send className="w-5 h-5 fill-current" />
          <span>Enviar pedido pelo WhatsApp</span>
        </button>

        <p className="text-center text-[11px] text-zinc-500">
          Você será redirecionado para o WhatsApp com a mensagem formatada para confirmação.
        </p>
      </div>
    </div>
  );
};
