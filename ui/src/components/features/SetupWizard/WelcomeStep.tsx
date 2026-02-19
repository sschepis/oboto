import { Button } from '../../../surface-kit/primitives/Button';

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full animate-fade-in-up">
      <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20 mb-8">
        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>

      <h1 className="text-3xl font-bold text-white mb-4">
        Welcome to RoboDev
      </h1>
      
      <p className="text-zinc-400 max-w-md mb-10 leading-relaxed">
        Your AI-powered development assistant is almost ready. 
        Let's get you set up with your preferred AI provider and workspace in just a few steps.
      </p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <Button variant="default" onClick={onNext} className="w-full py-6 text-base">
          Get Started
          <span className="ml-2">→</span>
        </Button>
        
        <button 
          onClick={onSkip}
          className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors py-2"
        >
          Skip setup (I'll configure manually)
        </button>
      </div>
    </div>
  );
}
