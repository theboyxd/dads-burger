import React, { useState } from 'react';
import { Calendar, Clock, Users, User, FileText, Send, Sparkles } from 'lucide-react';
import { ReservationPayload, StoreConfig } from '../types/menu';
import { buildWhatsAppReservationMessage } from '../utils/orderCalculator';

interface ReservasTabProps {
  config: StoreConfig;
  onShowToast: (msg: string) => void;
}

export const ReservasTab: React.FC<ReservasTabProps> = ({ config, onShowToast }) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  const minDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const [date, setDate] = useState(minDate);
  const [time, setTime] = useState('20:00');
  const [people, setPeople] = useState(2);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Hours options: 18:00 to 23:30 (typical dinner/burger service)
  const timeOptions: string[] = [];
  for (let h = 18; h <= 23; h++) {
    timeOptions.push(`${pad(h)}:00`);
    if (h < 23) {
      timeOptions.push(`${pad(h)}:30`);
    }
  }

  const handleBook = () => {
    if (!name.trim()) {
      setError('Por favor, informe seu nome para a reserva.');
      const nameInput = document.getElementById('res-name-input');
      if (nameInput) nameInput.focus();
      return;
    }

    setError(null);

    const payload: ReservationPayload = {
      name: name.trim(),
      date,
      time,
      people,
      notes: notes.trim() || undefined
    };

    const msg = buildWhatsAppReservationMessage(payload);
    const cleanPhone = config.whats.replace(/\D/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener');
    onShowToast('Abrindo WhatsApp para confirmar sua reserva! 📅');
  };

  return (
    <div className="w-full space-y-6 max-w-2xl mx-auto pb-12">
      {/* Header */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 tracking-tight">Reservar mesa</h2>
        <p className="text-xs sm:text-sm text-zinc-500 font-medium">
          Escolha o dia, horário e quantidade de pessoas. A confirmação chega direto pelo WhatsApp.
        </p>
      </div>

      {/* Hero card with atmosphere photo */}
      <div className="relative rounded-3xl overflow-hidden min-h-[190px] p-6 text-white flex flex-col justify-end shadow-lg bg-zinc-900 border border-zinc-800">
        <img
          src="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=75"
          alt="Salão Dad's Burger"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
        <div className="relative z-10 space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#FAB309] bg-black/60 px-3 py-0.5 rounded-full backdrop-blur-xs w-fit">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ambiente Aconchegante</span>
          </span>
          <h3 className="text-xl sm:text-2xl font-black">Aniversários, encontros e amigos</h3>
          <p className="text-xs sm:text-sm text-zinc-300">Garanta sua mesa antecipadamente aos finais de semana.</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-zinc-200/80 shadow-xs space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-[#FAB309]" />
              <span>Data da reserva</span>
            </label>
            <input
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900 font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#FAB309]" />
              <span>Horário</span>
            </label>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900 font-medium bg-white"
            >
              {timeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* People counter stepper */}
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#FAB309]" />
            <div>
              <span className="font-extrabold text-sm text-zinc-900 block">Número de pessoas</span>
              <span className="text-xs text-zinc-500">Mesa para até 20 pessoas</span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-white p-1 rounded-full border border-zinc-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setPeople(Math.max(1, people - 1))}
              disabled={people <= 1}
              aria-label="Menos uma pessoa"
              className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 flex items-center justify-center font-black disabled:opacity-40 transition-colors"
            >
              -
            </button>
            <span className="font-black text-sm w-4 text-center">{people}</span>
            <button
              type="button"
              onClick={() => setPeople(Math.min(20, people + 1))}
              disabled={people >= 20}
              aria-label="Mais uma pessoa"
              className="w-8 h-8 rounded-full bg-[#FAB309] hover:bg-[#d69700] text-black flex items-center justify-center font-black disabled:opacity-40 transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* Name input */}
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1 flex items-center gap-1.5">
            <User className="w-4 h-4 text-[#FAB309]" />
            <span>Nome completo para a reserva <span className="text-red-500">*</span></span>
          </label>
          <input
            id="res-name-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Ex: Carlos Eduardo Silveira"
            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900"
          />
        </div>

        {/* Observation / Special requests */}
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[#FAB309]" />
            <span>Observações especiais <span className="text-zinc-400 font-normal">(opcional)</span></span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: Aniversário, cadeirinha para bebê, mesa perto da janela..."
            className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#FAB309] text-sm text-zinc-900"
          />
        </div>

        {error && (
          <p className="text-xs font-bold text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">
            ⚠️ {error}
          </p>
        )}

        <button
          onClick={handleBook}
          className="w-full py-4 px-6 rounded-2xl bg-[#FAB309] hover:bg-[#d69700] text-black font-black text-base flex items-center justify-center gap-2.5 transition-all shadow-md active:scale-95"
        >
          <Send className="w-5 h-5 fill-current" />
          <span>Confirmar reserva pelo WhatsApp</span>
        </button>
      </div>
    </div>
  );
};
