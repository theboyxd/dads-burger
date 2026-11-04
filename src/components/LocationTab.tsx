import React from 'react';
import { MapPin, Clock, Star, Navigation, MessageCircle, ExternalLink } from 'lucide-react';
import { StoreConfig } from '../types/menu';

interface LocationTabProps {
  config: StoreConfig;
  isOpen: boolean;
  statusText: string;
}

export const LocationTab: React.FC<LocationTabProps> = ({ config, isOpen, statusText }) => {
  const encodedAddress = encodeURIComponent(`${config.nome} ${config.end}`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
  const iframeSrc = `https://maps.google.com/maps?q=${encodedAddress}&z=15&output=embed`;

  return (
    <div className="w-full space-y-6 max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-black text-zinc-950 tracking-tight">Onde estamos</h2>
        <p className="text-xs sm:text-sm text-zinc-500 font-medium">
          Venha nos visitar no Passo d'Areia em Porto Alegre ou peça para entregar na sua casa.
        </p>
      </div>

      {/* Embedded Map */}
      <div className="relative w-full h-64 sm:h-80 md:h-96 rounded-3xl overflow-hidden shadow-md border border-zinc-200 bg-zinc-200">
        <iframe
          title="Mapa do restaurante"
          src={iframeSrc}
          className="w-full h-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        ></iframe>
      </div>

      {/* Info Cards */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-zinc-200/80 shadow-xs space-y-4 divide-y divide-zinc-100">
        {/* Address */}
        <div className="flex items-start gap-3.5 pb-4 first:pt-0">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/80 text-[#FAB309] flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-extrabold text-sm sm:text-base text-zinc-900">Endereço</h4>
            <p className="text-xs sm:text-sm text-zinc-600 mt-0.5">{config.end}</p>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-800 mt-1 hover:underline"
            >
              <span>Ver no Google Maps</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Hours of operation */}
        <div className="flex items-start gap-3.5 py-4">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="font-extrabold text-sm sm:text-base text-zinc-900">Horário de funcionamento</h4>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {statusText}
              </span>
            </div>
            <div className="text-xs sm:text-sm text-zinc-600 space-y-0.5 pt-1">
              <p><span className="font-bold text-zinc-800">Terça a Domingo:</span> 18h00 às 23h45</p>
              <p><span className="font-bold text-zinc-800">Segunda-feira:</span> 18h00 às 23h30</p>
            </div>
          </div>
        </div>

        {/* Google Rating */}
        <div className="flex items-start gap-3.5 pt-4">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-500 flex items-center justify-center flex-shrink-0">
            <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
          </div>
          <div>
            <h4 className="font-extrabold text-sm sm:text-base text-zinc-900">Avaliação dos clientes</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-black text-sm text-zinc-950">{config.nota} de 5</span>
              <span className="text-zinc-400">•</span>
              <span className="text-xs text-zinc-500 font-medium">{config.aval} avaliações no Google</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action CTA Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-[#121212] hover:bg-zinc-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md active:scale-95 text-center"
        >
          <Navigation className="w-4 h-4 text-[#FAB309]" />
          <span>Como chegar</span>
        </a>

        <a
          href={`https://wa.me/${config.whats.replace(/\D/g, '')}?text=${encodeURIComponent('Olá! Gostaria de tirar uma dúvida sobre o Dad\'s Burger.')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-900 font-extrabold text-xs sm:text-sm transition-all shadow-xs active:scale-95 text-center"
        >
          <MessageCircle className="w-4 h-4 text-emerald-600" />
          <span>WhatsApp da loja</span>
        </a>
      </div>
    </div>
  );
};
