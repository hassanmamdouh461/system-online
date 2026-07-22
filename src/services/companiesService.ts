import { Company } from '../types/company';
import { companyRepository } from '../repositories';

/**
 * Companies Service - CRUD for company profiles (IndexedDB + optional Electron)
 */
export const companiesService = {
  async getAll(branchId?: string): Promise<Company[]> {
    try {
      return await companyRepository.getAll(branchId);
    } catch (error) {
      console.error('[companiesService] getAll error:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Company | null> {
    try {
      return await companyRepository.getById(id);
    } catch (error) {
      console.error('[companiesService] getById error:', error);
      return null;
    }
  },

  async save(company: Partial<Company> & { name: string }, branchId?: string): Promise<Company> {
    return await companyRepository.save(company, branchId);
  },

  async delete(id: string): Promise<void> {
    await companyRepository.delete(id);
  },
};
