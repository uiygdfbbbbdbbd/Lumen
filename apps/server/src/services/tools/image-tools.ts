import { ASPECT_RATIOS, type AspectRatio } from '@lumen/llm';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { ImageService } from '../images/image.service.js';
import type { Tool } from './registry.js';

export const IMAGE_GUIDANCE = 'Images: call generate_image when the user asks you to draw, design or create a picture. Write a detailed visual prompt (subject, style, composition, lighting). Generated images are shown to the user automatically, so don’t paste links; briefly describe what you made. Don’t generate images of real private people or sexual content.';

export function imageTools(images: ImageService, entitlements: EntitlementService): Tool[] {
  return [
    {
      definition: {
        name: 'generate_image',
        description: 'Generate images from a text description. They are shown to the user.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed description of the image.' },
            aspect_ratio: { type: 'string', enum: [...ASPECT_RATIOS] },
            n: { type: 'number', description: 'How many images (1-4).' },
          },
          required: ['prompt'],
        },
      },
      async run(args, ctx) {
        const ent = await entitlements.forUser(ctx.user);
        const made = await images.generate(ctx.user, ent, {
          prompt: String(args.prompt ?? ''),
          aspectRatio: ASPECT_RATIOS.includes(args.aspect_ratio as AspectRatio) ? (args.aspect_ratio as AspectRatio) : '1:1',
          n: Number(args.n) || 1,
          conversationId: ctx.conversationId,
          messageId: ctx.messageId ?? null,
        });
        return `Generated ${made.length} image${made.length === 1 ? '' : 's'} (shown to the user). image ids: ${made.map((i) => i.id).join(', ')}${made[0]?.revisedPrompt ? `\nThe provider interpreted the prompt as: ${made[0].revisedPrompt}` : ''}`;
      },
    },
  ];
}
