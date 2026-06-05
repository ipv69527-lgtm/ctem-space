from __future__ import annotations

import asyncio
from sqlalchemy import select
from app.config import settings
from app.database import engine, AsyncSessionLocal, Base
from app.models import *  # noqa: F403 - ensure model metadata is registered
from app.models.space_config import SpaceConfig
from app.models.template import Template


SYSTEM_TEMPLATES = [
    {
        "name": "资产清单报告",
        "desc": "面向资产盘点和交付验收，包含资产、端口、服务、位置和风险字段。",
        "content": "本报告覆盖 {{unit_name}}，生成时间 {{generated_at}}。\n本期纳入资产 {{asset_count}} 个，涉及单位 {{unit_count}} 个，严重/高危漏洞 {{critical_high}} 个。\n请重点核对资产归属、开放端口、服务暴露面和高风险资产处置情况。",
        "type": "xlsx",
        "vars": ["asset_count", "unit_name", "ip", "ports", "services", "risk"],
    },
    {
        "name": "漏洞整改报告",
        "desc": "面向整改闭环，包含漏洞清单、影响资产、处置状态、备注和修复建议。",
        "content": "本报告用于 {{unit_name}} 漏洞整改闭环跟踪。\n当前漏洞总数 {{vuln_count}} 个，其中严重/高危 {{critical_high}} 个，待整改/整改中/待复测 {{remediation_count}} 个。\n请按严重等级和影响资产优先级推进整改，并保留处置备注和复测结论。",
        "type": "docx",
        "vars": ["vuln_count", "critical_high", "status", "status_note", "solution"],
    },
    {
        "name": "单位风险排行报告",
        "desc": "面向管理层汇报，按单位聚合资产数、漏洞数、严重高危和风险评分。",
        "content": "本报告覆盖 {{unit_count}} 个单位、{{asset_count}} 个资产、{{vuln_count}} 个漏洞。\n当前风险最高单位为 {{top_risk_unit}}，严重/高危漏洞合计 {{critical_high}} 个。\n建议优先跟进排名靠前单位的高危资产、未闭环漏洞和同步异常问题。",
        "type": "xlsx",
        "vars": ["unit_name", "asset_count", "vuln_count", "critical_high", "risk_score"],
    },
    {
        "name": "同步质量报告",
        "desc": "面向运维排障，统计各单位同步任务成功率、失败数、最近结果和错误详情。",
        "content": "本报告用于数据接入与同步质量排障。\n当前统计同步任务 {{sync_task_count}} 个，失败任务 {{sync_failed_count}} 个，覆盖单位 {{unit_count}} 个。\n请优先处理失败任务的认证、查询条件、接口返回和字段映射问题。",
        "type": "xlsx",
        "vars": ["task_count", "success_rate", "failed_count", "last_task_status", "error_detail"],
    },
]


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(SpaceConfig).where(SpaceConfig.id == "default"))
        if not result.scalar_one_or_none():
            db.add(SpaceConfig(
                id="default",
                base_url=settings.SPACE_API_BASE_URL,
                username=settings.SPACE_API_USERNAME,
                password=settings.SPACE_API_PASSWORD,
                api_key=settings.SPACE_API_KEY,
                mock_mode=settings.SPACE_MOCK_MODE,
            ))
            await db.commit()
        for item in SYSTEM_TEMPLATES:
            template_result = await db.execute(
                select(Template).where(Template.name == item["name"], Template.source == "system")
            )
            template = template_result.scalar_one_or_none()
            if not template:
                db.add(Template(**item, source="system"))
            elif not (template.content or "").strip():
                template.content = item["content"]
                template.vars = item["vars"]
                template.desc = item["desc"]
                template.type = item["type"]
        await db.commit()


def main() -> None:
    asyncio.run(init_db())


if __name__ == "__main__":
    main()
