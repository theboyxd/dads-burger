import React, { useState } from 'react';
import { 
  X, Store, Printer, Sliders, CheckCircle2, Copy, 
  Search, ShieldCheck, ToggleLeft, ToggleRight, ExternalLink, RefreshCw
} from 'lucide-react';
import { MenuItem, StoreConfig } from '../types/menu';
import { buildKitchenComanda, formatBRL } from '../utils/orderCalculator';

interface OwnerDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StoreConfig;
  onUpdateConfig: (newConfig: StoreConfig) => void;
  menuItems: MenuItem[];
  onToggleItemAvailability: (itemId: string) => void;
  isStoreOpen: boolean;
  onToggleStoreOpen: () => void;
  onShowToast: (msg: string) => void;
}

export const OwnerDashboardModal: React.FC<OwnerDashboardModalProps> = ({
  isOpen,
  onClose,
  config,
  onUpdateConfig,
  menuItems,
  onToggleItemAvailability,
  isStoreOpen,
  onToggleStoreOpen,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<'comandas' | 'estoque' | 'config'>('comandas');
  const [stockSearch, setStockSearch] = useState('');
  
  // Customizer state
  const [editNome, setEditNome] = useState(config.nome);
  const [editWhats, setEditWhats] = useState(config.whats);
  const [editEnd, setEditEnd] = useState(config.end);
  const [editCor, setEditCor] = useState(config.cor);
  const [editCor2, setEditCor2] = useState(config.cor2);

  if (!isOpen) return null;

  // Filtered stock list
  const filteredItems = menuItems.filter(m => 
    m.name.toLowerCase().includes(stockSearch.toLowerCase()) || 
    m.cat.toLowerCase().includes(stockSearch.toLowerCase())
  );

  // Sample order for kitchen ticket simulation
  const sampleOrderTicket = buildKitchenComanda({
    customerName: 'Renata Vargas',
    items: [
      { item: menuItems[0] || { id: '1', cat: 'Combos', name: "Combo na Caixa: 2x Big Bacon", desc: '', price: 94.9, img: '' }, quantity: 1 },
      { item: menuItems[1] || { id: '2', cat: 'Bebidas', name: "Coca-Cola 350ml", desc: '', price: 9.9, img: '' }, quantity: 2 }
    ],
    mode: 'entrega',
    deliveryAddress: "Av. Plínio Brasil Milano, 1420 - Passo d'Areia",
    deliveryReference: 'Apto 402, Interfone 402',
    paymentMethod: 'pix',
    subtotal: 114.70,
    deliveryFee: 0,
    total: 114.70
  }, 142);

  const handleSaveConfig = () => {
    onUpdateConfig({
      ...config,
      nome: editNome.trim() || config.nome,
      whats: editWhats.trim() || config.whats,
      end: editEnd.trim() || config.end,
      cor: editCor,
      cor2: editCor2
    });
    onShowToast('Configurações do estabelecimento atualizadas! ✨');
  };

  const handleCopyClientLink = async () => {
    const url = window.location.origin + window.location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      onShowToast('Link do cardápio copiado para o WhatsApp! 📲');
    } catch {
      onShowToast('Link do cardápio pronto para compartilhar!');
    }
  };

  const handleCopyTicket = async () => {
    try {
      await navigator.clipboard.writeText(sampleOrderTicket);
      onShowToast('Texto da comanda copiado para a impressora! 🖨️');
    } catch {
      onShowToast('Texto da comanda pronto!');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-xs animate-fade-in">
      <div 
        className="w-full max-w-4xl max-h-[92vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#121212] text-white p-4 sm:p-6 flex items-center justify-between border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FAB309] text-black flex items-center justify-center font-black">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-extrabold text-[#FAB309] tracking-wider">Gestão do Estabelecimento</span>
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Área do Dono
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-black text-white">{config.nome}</h3>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Fechar painel do dono"
            className="w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick KPI Bar */}
        <div className="bg-zinc-50 border-b border-zinc-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm flex-shrink-0">
          <div className="flex items-center gap-4 sm:gap-6">
            <div>
              <span className="text-zinc-500 font-medium">Produtos ativos:</span>{' '}
              <strong className="text-zinc-900 font-black">{menuItems.filter(m => m.available !== false).length} / {menuItems.length}</strong>
            </div>
            <div>
              <span className="text-zinc-500 font-medium">WhatsApp:</span>{' '}
              <strong className="text-zinc-900 font-black">{config.whats}</strong>
            </div>
          </div>

          {/* Store status manual toggle */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 font-semibold text-xs">Loja aberta agora:</span>
            <button
              onClick={onToggleStoreOpen}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black transition-all ${
                isStoreOpen
                  ? 'bg-emerald-500 text-white'
                  : 'bg-zinc-300 text-zinc-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
              <span>{isStoreOpen ? 'ABERTO' : 'FECHADO'}</span>
            </button>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-zinc-200 px-4 sm:px-6 bg-white gap-2 flex-shrink-0 pt-2">
          <button
            onClick={() => setActiveTab('comandas')}
            className={`py-3 px-3 sm:px-4 text-xs sm:text-sm font-extrabold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'comandas'
                ? 'border-[#FAB309] text-zinc-950 font-black'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Printer className="w-4 h-4 text-amber-600" />
            <span>Simulador de Comanda</span>
          </button>

          <button
            onClick={() => setActiveTab('estoque')}
            className={`py-3 px-3 sm:px-4 text-xs sm:text-sm font-extrabold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'estoque'
                ? 'border-[#FAB309] text-zinc-950 font-black'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Sliders className="w-4 h-4 text-amber-600" />
            <span>Pausar Itens (Estoque)</span>
          </button>

          <button
            onClick={() => setActiveTab('config')}
            className={`py-3 px-3 sm:px-4 text-xs sm:text-sm font-extrabold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'config'
                ? 'border-[#FAB309] text-zinc-950 font-black'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <span>Configurações & Link</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* TAB 1: COMANDAS / TICKET PRINTER SIMULATOR */}
          {activeTab === 'comandas' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-extrabold text-base text-zinc-900">
                    Visualização de Comanda para Cozinha & Balcão
                  </h4>
                  <p className="text-xs text-zinc-500">
                    Formato padronizado de pedido como chega no WhatsApp ou sai na impressora térmica (58mm/80mm).
                  </p>
                </div>
                <button
                  onClick={handleCopyTicket}
                  className="bg-[#121212] hover:bg-zinc-800 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 self-start sm:self-auto transition-transform active:scale-95"
                >
                  <Copy className="w-3.5 h-3.5 text-[#FAB309]" />
                  <span>Copiar Comanda</span>
                </button>
              </div>

              {/* Receipt simulator box */}
              <div className="bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-800 text-emerald-400 font-mono text-xs sm:text-sm whitespace-pre leading-relaxed overflow-x-auto shadow-inner">
                {sampleOrderTicket}
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Legibilidade para a equipe de atendimento</span>
                </p>
                <p className="text-zinc-600">
                  Os pedidos enviados pelos clientes contêm automaticamente a numeração de itens, endereço com ponto de referência, e cálculo exato de troco em dinheiro.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: ESTOQUE / PAUSAR ITENS */}
          {activeTab === 'estoque' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-extrabold text-base text-zinc-900">
                    Disponibilidade de Itens do Cardápio
                  </h4>
                  <p className="text-xs text-zinc-500">
                    Faltou ingrediente na chapa ou acabou a bebida? Desative o item aqui para marcar como "Esgotado hoje" no cardápio.
                  </p>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                  <input
                    type="text"
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                    placeholder="Filtrar produtos..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309]"
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="border border-zinc-200 rounded-2xl divide-y divide-zinc-100 max-h-96 overflow-y-auto">
                {filteredItems.map(item => {
                  const available = item.available !== false;
                  return (
                    <div 
                      key={item.id}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-zinc-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img 
                          src={item.img} 
                          alt={item.name} 
                          className="w-10 h-10 rounded-lg object-cover bg-zinc-100 flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-xs sm:text-sm text-zinc-900 truncate">
                            {item.name}
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            {item.cat} • {formatBRL(item.price)}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          onToggleItemAvailability(item.id);
                          onShowToast(`${item.name}: ${available ? 'Pausado (Esgotado)' : 'Ativado!'}`);
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 transition-all ${
                          available
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300'
                        }`}
                      >
                        {available ? (
                          <>
                            <ToggleRight className="w-4 h-4 text-emerald-600" />
                            <span>Disponível</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="w-4 h-4 text-zinc-500" />
                            <span>Pausado</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: CONFIGURAÇÃO & LINK DO CLIENTE */}
          {activeTab === 'config' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-extrabold text-base text-zinc-900">
                  Configurações da Loja
                </h4>
                <p className="text-xs text-zinc-500">
                  Ajuste os dados de contato do Dad's Burger e copie o link direto para divulgação nas redes sociais.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    Nome do Restaurante
                  </label>
                  <input
                    type="text"
                    value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs sm:text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    WhatsApp para Pedidos (apenas números com DDD)
                  </label>
                  <input
                    type="text"
                    value={editWhats}
                    onChange={(e) => setEditWhats(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs sm:text-sm font-semibold"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    Endereço Completo
                  </label>
                  <input
                    type="text"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs sm:text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    Cor Principal (Destaque)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={editCor}
                      onChange={(e) => setEditCor(e.target.value)}
                      className="w-10 h-10 p-1 rounded-xl border border-zinc-200 cursor-pointer"
                    />
                    <span className="font-mono text-xs">{editCor}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    Cor dos Botões Escuros
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={editCor2}
                      onChange={(e) => setEditCor2(e.target.value)}
                      className="w-10 h-10 p-1 rounded-xl border border-zinc-200 cursor-pointer"
                    />
                    <span className="font-mono text-xs">{editCor2}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-200">
                <button
                  onClick={handleSaveConfig}
                  className="bg-[#121212] hover:bg-zinc-800 text-white font-extrabold text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-xs transition-transform active:scale-95"
                >
                  Salvar Alterações
                </button>

                <button
                  onClick={handleCopyClientLink}
                  className="bg-[#FAB309] hover:bg-[#d99800] text-black font-extrabold text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-xs transition-transform active:scale-95 flex items-center gap-1.5"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copiar Link do Cardápio para o WhatsApp</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
