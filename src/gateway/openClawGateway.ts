export class OpenClawGateway {
  constructor() {
    console.log('OpenClaw Gateway initialized');
  }

  executeSkill(skillName: string, params: any): Promise<any> {
    console.log(`Executing skill: ${skillName}`, params);
    return Promise.resolve({ success: true });
  }
}
