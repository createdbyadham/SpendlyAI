import { motion, Variants, HTMLMotionProps } from 'framer-motion';
import React from 'react';

type Preset = "fade-in-blur";
type Per = "char" | "word" | "line";

interface TextEffectProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: string;
  as?: React.ElementType;
  preset?: Preset;
  per?: Per;
  speedSegment?: number;
  delay?: number;
}

const presets: Record<Preset, (i: number, speed: number, delay: number) => Variants> = {
  "fade-in-blur": (i, speed, delay) => ({
    hidden: { opacity: 0, filter: 'blur(12px)', y: 12 },
    visible: {
      opacity: 1,
      filter: 'blur(0px)',
      y: 0,
      transition: {
        type: 'spring',
        bounce: 0.3,
        duration: 1.5,
        delay: delay + i * speed,
      },
    },
  }),
};

export const TextEffect: React.FC<TextEffectProps> = ({
  children,
  as: Component = 'div',
  preset = 'fade-in-blur',
  per = 'char',
  speedSegment = 0.05,
  delay = 0,
  ...props
}) => {
  const text = children;
  
  const segments = React.useMemo(() => {
    if (per === 'line') {
      return text.split('\n').map(line => line.split(' '));
    }
    if (per === 'word') {
      return text.split(' ');
    }
    return text.split('');
  }, [text, per]);

  const presetVariants = presets[preset];

  if (per === 'line') {
    return (
        <Component {...props}>
            {segments.map((line, lineIndex) => (
                <span key={lineIndex} style={{ display: 'block' }} aria-label={Array.isArray(line) ? line.join(' ') : undefined}>
                    {(line as string[]).map((word, wordIndex) => (
                        <motion.span
                            key={wordIndex}
                            style={{ display: 'inline-block', marginRight: '0.25em' }}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true }}
                            variants={presetVariants(lineIndex * (line as string[]).length + wordIndex, speedSegment, delay)}
                        >
                            {word}
                        </motion.span>
                    ))}
                </span>
            ))}
        </Component>
    );
  }

  return (
    <Component {...props}>
      <span style={{ display: 'inline-block' }} aria-label={text}>
        {(segments as string[]).map((segment, index) => (
          <motion.span
            key={index}
            style={{ display: 'inline-block' }}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={presetVariants(index, speedSegment, delay)}
          >
            {segment}{per === 'word' ? '\u00A0' : ''}
          </motion.span>
        ))}
      </span>
    </Component>
  );
}; 